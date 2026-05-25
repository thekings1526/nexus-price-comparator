const competitors = [
  { id: "mex", name: "Mex" },
  { id: "rafa", name: "Rafa" },
  { id: "ngcp", name: "NGCP" },
  { id: "coelho", name: "Coelho" }
];

const APP_SCHEMA_VERSION = 4;
const REVIEW_CACHE_KEY = "nexus-review-decisions";
const SEARCH_RENDER_DELAY_MS = 120;
const ROW_RENDER_BATCH_SIZE = 70;
const REVIEW_FAMILY_IGNORED_TOKENS = new Set([
  "ps4",
  "ps5",
  "ps3",
  "playstation",
  "midia",
  "digital",
  "primaria",
  "primario",
  "primary",
  "secundaria",
  "secundario",
  "secondary",
  "licenca",
  "jogo",
  "game",
  "games"
]);

const demoReport = {
  schemaVersion: APP_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  source: "demo",
  totalItems: 0,
  items: []
};

const state = {
  report: loadStoredReport() || demoReport,
  remoteStatus: null,
  status: "all",
  license: "all",
  search: "",
  sort: "status",
  threshold: 2,
  reviewDecisions: loadStoredReviewDecisions(),
  entryCache: null,
  searchTimer: null,
  rowsRenderJob: {
    id: 0,
    handle: null,
    idle: false
  },
  refreshTimer: null,
  review: {
    modalContext: null,
    loading: false,
    requestKey: "",
    candidatesCache: new Map(),
    candidateRequests: new Map()
  }
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const elements = {
  rows: document.querySelector("#rows"),
  summaryGrid: document.querySelector("#summaryGrid"),
  syncStatus: document.querySelector("#syncStatus"),
  syncDetails: document.querySelector("#syncDetails"),
  syncProgress: document.querySelector("#syncProgress"),
  runWorkerButton: document.querySelector("#runWorkerButton"),
  resultsCount: document.querySelector("#resultsCount"),
  boardMeta: document.querySelector("#boardMeta"),
  searchInput: document.querySelector("#searchInput"),
  statusSelect: document.querySelector("#statusSelect"),
  licenseSelect: document.querySelector("#licenseSelect"),
  sortSelect: document.querySelector("#sortSelect"),
  thresholdInput: document.querySelector("#thresholdInput")
  ,
  reviewModal: document.querySelector("#reviewModal"),
  reviewModalTitle: document.querySelector("#reviewModalTitle"),
  reviewModalBody: document.querySelector("#reviewModalBody"),
  closeReviewModal: document.querySelector("#closeReviewModal")
};

bindEvents();
render();
loadSavedReport();
state.refreshTimer = setInterval(loadSavedReport, 15000);

function loadStoredReport() {
  try {
    const raw = localStorage.getItem("nexus-price-report");
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.schemaVersion === APP_SCHEMA_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function storeReport(report) {
  localStorage.setItem("nexus-price-report", JSON.stringify(report));
}

function loadStoredReviewDecisions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REVIEW_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function storeReviewDecisions() {
  localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify(state.reviewDecisions));
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.search = normalizeSearchText(event.target.value);
    scheduleSearchRender();
  });

  elements.statusSelect.addEventListener("change", (event) => {
    state.status = event.target.value;
    render();
  });

  elements.licenseSelect.addEventListener("change", (event) => {
    state.license = event.target.value;
    render();
  });

  elements.sortSelect.addEventListener("change", (event) => {
    state.sort = event.target.value;
    render();
  });

  elements.thresholdInput.addEventListener("input", (event) => {
    state.threshold = Number(event.target.value) || 0;
    invalidateEntries();
    render();
  });

  elements.runWorkerButton.addEventListener("click", triggerWorkerRun);
  elements.rows.addEventListener("click", handleReviewAction);
  elements.rows.addEventListener("pointerover", handleReviewPrefetch);
  elements.closeReviewModal.addEventListener("click", closeReviewModal);
  elements.reviewModal.addEventListener("click", (event) => {
    if (event.target === elements.reviewModal) closeReviewModal();
  });
  elements.reviewModalBody.addEventListener("click", handleModalAction);
  elements.reviewModalBody.addEventListener("submit", handleModalSearch);
}

function render() {
  const entries = getEntries();
  const filtered = sortEntries(entries.filter(matchesFilters));
  renderSummary(entries);
  renderRows(filtered);
  renderSyncStatus();
}

function getEntries() {
  const cacheKey = [
    state.report.generatedAt || "",
    state.report.items?.length || 0,
    state.threshold
  ].join(":");
  if (state.entryCache?.key === cacheKey) return state.entryCache.entries;

  const entries = (state.report.items || []).flatMap((item) => (
    Object.entries(item.licenses || {}).map(([license, payload]) => {
      const competitorPrices = Object.entries(payload.competitors || {})
        .map(([id, value]) => ({ id, ...value }))
        .filter((value) => isCompetitorPriceCountable(item.url, value.id, value));
      const best = competitorPrices.slice().sort((a, b) => a.price - b.price)[0] || null;
      const diff = best && typeof payload.myPrice === "number" ? payload.myPrice - best.price : null;
      return {
        item,
        license,
        myPrice: payload.myPrice,
        competitorData: payload.competitors || {},
        best,
        diff,
        status: classify(diff, best),
        searchText: normalizeSearchText(`${item.title || ""} ${item.platform || ""}`)
      };
    })
  ));
  state.entryCache = { key: cacheKey, entries };
  return entries;
}

function invalidateEntries() {
  state.entryCache = null;
}

function isCompetitorPriceCountable(ownUrl, competitorId, value) {
  if (!value || typeof value.price !== "number") return false;
  const local = state.reviewDecisions?.[reviewDecisionKey(ownUrl, competitorId)];
  if (local && shouldApplyStoredDecision(state.report, local)) {
    if (local.action === "missing-today") return false;
    if (local.action === "wrong" && sameReviewUrl(local.competitorUrl, value.url)) return false;
  }
  if (value.review?.status === "missing-today" || value.review?.status === "wrong") return false;
  if ((value.review?.reasons || []).some((reason) => /marcou este par como errado/i.test(reason))) return false;
  return true;
}

function classify(diff, best) {
  if (!best || diff === null) return "missing";
  if (Math.abs(diff) <= state.threshold) return "close";
  return diff > 0 ? "expensive" : "cheaper";
}

function matchesFilters(entry) {
  if (state.status !== "all" && entry.status !== state.status) return false;
  if (state.license !== "all" && entry.license !== state.license) return false;
  if (!state.search) return true;
  return entry.searchText.includes(state.search);
}

function sortEntries(entries) {
  const priority = { expensive: 0, close: 1, missing: 2, cheaper: 3 };
  return entries.slice().sort((a, b) => {
    if (state.sort === "gapRisk") return valueOrNegativeInfinity(b.diff) - valueOrNegativeInfinity(a.diff);
    if (state.sort === "gapAdvantage") return valueOrInfinity(a.diff) - valueOrInfinity(b.diff);
    if (state.sort === "mineAsc") return valueOrInfinity(a.myPrice) - valueOrInfinity(b.myPrice);
    if (state.sort === "mineDesc") return valueOrInfinity(b.myPrice) - valueOrInfinity(a.myPrice);
    if (state.sort === "competitorAsc") return valueOrInfinity(a.best?.price) - valueOrInfinity(b.best?.price);
    if (state.sort === "competitorDesc") return valueOrInfinity(b.best?.price) - valueOrInfinity(a.best?.price);
    if (state.sort === "nameAsc") return a.item.title.localeCompare(b.item.title);
    if (state.sort === "nameDesc") return b.item.title.localeCompare(a.item.title);
    return priority[a.status] - priority[b.status] || Math.abs(b.diff || 0) - Math.abs(a.diff || 0);
  });
}

function renderSummary(entries) {
  const counts = entries.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] || 0) + 1;
    return acc;
  }, { expensive: 0, close: 0, cheaper: 0, missing: 0 });
  elements.summaryGrid.innerHTML = `
    <article class="metric metric-risk"><b>${counts.expensive}</b><span>Nexus mais caro</span></article>
    <article class="metric metric-aligned"><b>${counts.close}</b><span>Preco alinhado</span></article>
    <article class="metric metric-advantage"><b>${counts.cheaper}</b><span>Nexus mais barato</span></article>
    <article class="metric metric-missing"><b>${counts.missing}</b><span>Sem referencia</span></article>
  `;
}

function renderRows(entries) {
  cancelRowsRenderJob();
  elements.resultsCount.textContent = `${entries.length} ${entries.length === 1 ? "resultado" : "resultados"}`;
  elements.boardMeta.textContent = state.report.generatedAt
    ? `Atualizado em ${formatDate(state.report.generatedAt)}`
    : "Aguardando dados";

  if (!entries.length) {
    elements.rows.innerHTML = '<div class="empty-state">Nenhum produto encontrado com os filtros atuais.</div>';
    return;
  }

  const jobId = ++state.rowsRenderJob.id;
  const firstBatch = entries.slice(0, ROW_RENDER_BATCH_SIZE);
  elements.rows.innerHTML = firstBatch.map(renderRow).join("");
  scheduleRowsBatch(entries, ROW_RENDER_BATCH_SIZE, jobId);
}

function renderRow(entry) {
  const licenseLabel = entry.license === "primary" ? "Primaria" : "Secundaria";
  const licenseClass = entry.license === "primary" ? "license-primary" : "license-secondary";
  const statusLabel = {
    expensive: "Acima do mercado",
    close: "Preco alinhado",
    cheaper: "Abaixo do mercado",
    missing: "Sem referencia"
  }[entry.status];

  return `
    <article class="price-row comparison-card status-row-${entry.status}">
      <div class="card-main">
        <div class="game-cell">
          ${entry.item.image ? `<img src="${entry.item.image}" alt="" loading="lazy" onerror="this.remove()">` : `<img alt="">`}
          <div>
            <a class="game-title" href="${entry.item.url || "#"}" target="_blank" rel="noreferrer">${escapeHtml(entry.item.title)}</a>
            <div class="game-meta">
              <span>${entry.item.platform || "Plataforma"}</span>
              <span class="tag ${licenseClass}">${licenseLabel}</span>
              <span class="status-tag status-${entry.status}">${statusLabel}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="price-strip">
        <div class="price-box">
          <span>Preco Nexus</span>
          <strong>${formatPrice(entry.myPrice)}</strong>
        </div>
        <div class="price-box">
          <span>Melhor concorrente</span>
          <strong>${entry.best ? formatPrice(entry.best.price) : "Sem preco"}</strong>
          ${entry.best ? `<small>${findCompetitor(entry.best.id)?.name || entry.best.id}</small>` : ""}
        </div>
        <div class="price-box price-box-diff">
          <span>Variacao</span>
          <strong class="diff ${diffClass(entry.diff)}">${formatDiff(entry.diff)}</strong>
        </div>
      </div>

      <div class="competitor-area">
        <span class="competitor-area-title">Concorrentes</span>
        <div class="competitors">${renderCompetitors(entry)}</div>
      </div>
    </article>
  `;
}

function scheduleRowsBatch(entries, start, jobId) {
  if (start >= entries.length || jobId !== state.rowsRenderJob.id) {
    if (jobId === state.rowsRenderJob.id) state.rowsRenderJob.handle = null;
    return;
  }
  const run = () => {
    if (jobId !== state.rowsRenderJob.id) return;
    state.rowsRenderJob.handle = null;
    const nextStart = start + ROW_RENDER_BATCH_SIZE;
    elements.rows.insertAdjacentHTML("beforeend", entries.slice(start, nextStart).map(renderRow).join(""));
    scheduleRowsBatch(entries, nextStart, jobId);
  };
  if ("requestIdleCallback" in window) {
    state.rowsRenderJob.idle = true;
    state.rowsRenderJob.handle = window.requestIdleCallback(run, { timeout: 120 });
    return;
  }
  state.rowsRenderJob.idle = false;
  state.rowsRenderJob.handle = window.setTimeout(run, 16);
}

function cancelRowsRenderJob() {
  if (!state.rowsRenderJob.handle) return;
  if (state.rowsRenderJob.idle && "cancelIdleCallback" in window) {
    window.cancelIdleCallback(state.rowsRenderJob.handle);
  } else {
    window.clearTimeout(state.rowsRenderJob.handle);
  }
  state.rowsRenderJob.handle = null;
}

function scheduleSearchRender() {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => {
    state.searchTimer = null;
    render();
  }, SEARCH_RENDER_DELAY_MS);
}

function renderCompetitors(entry) {
  return competitors.map((competitor) => {
    const value = entry.competitorData[competitor.id];
    const ignored = value && !isCompetitorPriceCountable(entry.item.url, competitor.id, value);
    const bestClass = !ignored && entry.best?.id === competitor.id ? " best" : "";
    const missingClass = value?.price && !ignored ? "" : " missing";
    const note = ignored ? "Ignorado no calculo" : value?.available === false ? "Indisponivel" : (entry.best?.id === competitor.id ? "Menor preco" : "");
    const review = value?.review;
    const reviewClass = review?.status ? ` review-${review.status}` : "";
    const reviewText = review ? `${review.label} (${review.confidence}%)` : "IA: sem leitura";
    const manualState = manualReviewState(entry.item.url, competitor.id, review);
    const actionMarkup = manualState.done ? renderResolvedReviewAction(entry, competitor, value, manualState) : `
      <span class="review-actions">
        ${value?.url ? `<button type="button" data-review-action="confirm" data-own-url="${escapeAttr(entry.item.url)}" data-competitor-id="${competitor.id}" data-competitor-url="${escapeAttr(value.url)}">Produto correto</button>` : ""}
        <button type="button" data-review-action="choose" data-own-url="${escapeAttr(entry.item.url)}" data-competitor-id="${competitor.id}" data-competitor-url="${escapeAttr(value?.url || "")}">Trocar produto</button>
      </span>
    `;
    const content = `
      <div class="competitor-top">
        <span class="competitor-name">${competitor.name}</span>
        ${value?.url ? `<a class="source-link" href="${value.url}" target="_blank" rel="noreferrer">Origem</a>` : ""}
      </div>
      <strong>${value?.price && !ignored ? formatPrice(value.price) : "Sem preco"}</strong>
      ${note ? `<small>${note}</small>` : ""}
      <small class="review-pill${reviewClass}">${escapeHtml(reviewText)}</small>
      ${actionMarkup}
    `;
    return `<div class="competitor${bestClass}${missingClass}">
      ${content}
    </div>`;
  }).join("");
}

function renderResolvedReviewAction(entry, competitor, value, manualState) {
  if (manualState.status === "missing-today" || manualState.status === "wrong") {
    return `
      <button class="review-mini-action" type="button" data-review-action="choose" data-own-url="${escapeAttr(entry.item.url)}" data-competitor-id="${competitor.id}" data-competitor-url="${escapeAttr(value?.url || "")}">Revisar</button>
    `;
  }
  return "";
}

function manualReviewState(ownUrl, competitorId, review) {
  const local = state.reviewDecisions?.[reviewDecisionKey(ownUrl, competitorId)];
  if (local && shouldApplyStoredDecision(state.report, local)) {
    return {
      done: true,
      status: local.action === "missing-today" ? "missing-today" : local.action === "wrong" ? "wrong" : "confirmed"
    };
  }
  if (review?.status === "confirmed" || review?.status === "missing-today" || review?.status === "wrong") {
    return { done: true, status: review.status };
  }
  if ((review?.reasons || []).some((reason) => /marcou este par como errado/i.test(reason))) return { done: true, status: "wrong" };
  return { done: false, status: review?.status || "" };
}

async function handleReviewAction(event) {
  const button = event.target.closest("[data-review-action]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();

  const action = button.dataset.reviewAction;
  const payload = {
    action,
    ownUrl: button.dataset.ownUrl,
    competitorId: button.dataset.competitorId,
    competitorUrl: button.dataset.competitorUrl || ""
  };

  if (action === "choose") {
    openReviewModal(payload);
    return;
  }

  if (action === "confirm" && !payload.competitorUrl) {
    openReviewModal({ ...payload, action: "choose" });
    return;
  }

  saveReviewDecision(payload, button);
}

async function saveReviewDecision(payload, button, options = {}) {
  const optimistic = options.optimistic !== false;
  const silent = options.silent === true;
  const original = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Salvando";
  }
  if (optimistic) {
    applyLocalReviewDecision(payload);
    render();
  }
  try {
    const response = await fetch("/api/review-decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Nao consegui salvar");
    const serverApplied = applyServerReviewDecisions(result.overrides?.appliedDecisions || []);
    if (!optimistic) {
      applyLocalReviewDecision(payload);
      render();
    } else if (serverApplied) {
      render();
    }
    if (button) button.textContent = "Salvo";
    setTimeout(loadSavedReport, 1800);
  } catch (error) {
    if (!silent) window.alert(error.message || "Nao consegui salvar a revisao.");
    setTimeout(loadSavedReport, 300);
    if (button) button.textContent = original;
  } finally {
    if (button) {
      setTimeout(() => {
        button.disabled = false;
        button.textContent = original;
      }, 1200);
    }
  }
}

function applyLocalReviewDecision(payload) {
  rememberReviewDecision(payload);
  applyReviewDecisionToReport(state.report, payload);
  invalidateEntries();
  storeReport(state.report);
}

function applyServerReviewDecisions(decisions) {
  if (!Array.isArray(decisions) || !decisions.length) return false;
  let changed = false;
  for (const decision of decisions) {
    if (!decision?.ownUrl || !decision?.competitorId) continue;
    const payload = {
      action: decision.action,
      ownUrl: decision.ownUrl,
      competitorId: decision.competitorId,
      competitorUrl: decision.competitorUrl || ""
    };
    const key = reviewDecisionKey(payload.ownUrl, payload.competitorId);
    state.reviewDecisions[key] = {
      ...payload,
      candidate: null,
      savedAt: decision.savedAt || new Date().toISOString()
    };
    const item = (state.report.items || []).find((product) => product.url === payload.ownUrl);
    if (item) applyReviewDecisionToItem(item, payload);
    changed = true;
  }
  if (!changed) return false;
  invalidateEntries();
  storeReviewDecisions();
  storeReport(state.report);
  return true;
}

function rememberReviewDecision(payload) {
  if (!payload.ownUrl || !payload.competitorId) return;
  for (const relatedPayload of relatedReviewPayloads(state.report, payload)) {
    const key = reviewDecisionKey(relatedPayload.ownUrl, relatedPayload.competitorId);
    state.reviewDecisions[key] = {
      action: relatedPayload.action,
      ownUrl: relatedPayload.ownUrl,
      competitorId: relatedPayload.competitorId,
      competitorUrl: relatedPayload.competitorUrl || "",
      candidate: relatedPayload.candidate || null,
      savedAt: new Date().toISOString()
    };
  }
  storeReviewDecisions();
}

function applyReviewDecisionToReport(report, payload) {
  for (const relatedPayload of relatedReviewPayloads(report, payload)) {
    const item = (report.items || []).find((product) => product.url === relatedPayload.ownUrl);
    if (item) applyReviewDecisionToItem(item, relatedPayload);
  }
}

function applyReviewDecisionToItem(item, payload) {
  Object.values(item.licenses || {}).forEach((license) => {
    license.competitors = license.competitors || {};
    const competitor = license.competitors[payload.competitorId] || {};
    license.competitors[payload.competitorId] = competitor;
    if (!competitor) return;
    const isMissing = payload.action === "missing-today";
    const isWrong = payload.action === "wrong";
    if (isWrong && payload.competitorUrl && competitor.url && !sameReviewUrl(payload.competitorUrl, competitor.url)) return;
    const licenseKey = license === item.licenses?.primary ? "primary" : "secondary";
    const candidateLicense = payload.candidate?.licenses?.[licenseKey];
    competitor.review = {
      ...(competitor.review || {}),
      status: isMissing ? "missing-today" : isWrong ? "wrong" : "confirmed",
      confidence: isMissing || isWrong ? 1 : 100,
      label: isMissing ? "Sem produto hoje" : isWrong ? "Marcado incorreto" : "Confirmado por voce",
      reasons: isMissing ? ["Marcado como ausente nesta revisao"] : isWrong ? ["Voce marcou este par como errado"] : ["Vinculo salvo manualmente"]
    };
    if ((payload.action === "choose" || payload.action === "confirm") && payload.competitorUrl) competitor.url = payload.competitorUrl;
    if (isMissing || isWrong) competitor.available = false;
    if (!isMissing && !isWrong) competitor.available = true;
    if (payload.candidate) {
      competitor.title = payload.candidate.title || competitor.title;
      competitor.available = candidateLicense?.available ?? competitor.available;
      if (typeof candidateLicense?.price === "number") competitor.price = candidateLicense.price;
    }
  });
}

function relatedReviewPayloads(report, payload) {
  const source = (report?.items || []).find((product) => product.url === payload.ownUrl);
  if (!source) return [payload];
  const familyKey = reviewFamilyKey(source);
  if (!familyKey) return [payload];
  return (report.items || [])
    .filter((item) => reviewFamilyKey(item) === familyKey)
    .filter((item) => shouldShareReviewFamily(source, item))
    .map((item) => {
      if (item.url === payload.ownUrl) return payload;
      const competitorUrl = reviewCompetitorUrlForItem(item, payload.competitorId) || "";
      if (payload.action !== "missing-today" && !competitorUrl) return null;
      return {
        ...payload,
        ownUrl: item.url,
        competitorUrl,
        candidate: null
      };
    })
    .filter(Boolean);
}

function reviewCompetitorUrlForItem(item, competitorId) {
  for (const license of Object.values(item.licenses || {})) {
    const url = license?.competitors?.[competitorId]?.url;
    if (url) return url;
  }
  return "";
}

function reviewFamilyKey(item) {
  const text = normalizeSearchText(`${item?.title || ""}`);
  if (!text) return "";
  return text
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !REVIEW_FAMILY_IGNORED_TOKENS.has(token))
    .join(" ");
}

function shouldShareReviewFamily(source, item) {
  const sourcePlatform = reviewPlatformKey(source);
  if (sourcePlatform === "ps4" || sourcePlatform === "ps5") {
    const targetPlatform = reviewPlatformKey(item);
    return targetPlatform === "ps4" || targetPlatform === "ps5";
  }
  return source?.url === item?.url;
}

function reviewPlatformKey(item) {
  const text = normalizeSearchText(`${item?.platform || ""} ${item?.title || ""}`);
  if (/\bps5\b|playstation 5/.test(text)) return "ps5";
  if (/\bps4\b|playstation 4/.test(text)) return "ps4";
  return "";
}

function applyStoredReviewDecisions(report) {
  Object.values(state.reviewDecisions || {})
    .filter((decision) => shouldApplyStoredDecision(report, decision))
    .forEach((decision) => applyReviewDecisionToReport(report, decision));
  return report;
}

function shouldApplyStoredDecision(report, decision) {
  if (!report?.generatedAt || !decision?.savedAt) return true;
  return new Date(report.generatedAt).getTime() <= new Date(decision.savedAt).getTime();
}

function reviewDecisionKey(ownUrl, competitorId) {
  return `${ownUrl}::${competitorId}`;
}

function sameReviewUrl(left, right) {
  return normalizeReviewUrl(left) === normalizeReviewUrl(right);
}

function normalizeReviewUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim().replace(/\/$/, "");
  }
}

async function openReviewModal(context, query = "") {
  const requestKey = reviewCandidateCacheKey(context, query);
  state.review.modalContext = { ...context, query };
  state.review.requestKey = requestKey;
  elements.reviewModal.hidden = false;
  elements.reviewModalTitle.textContent = `${findCompetitor(context.competitorId)?.name || context.competitorId}: corrigir vinculo`;
  if (state.review.candidatesCache.has(requestKey)) {
    renderReviewCandidates(state.review.candidatesCache.get(requestKey));
  } else {
    renderReviewCandidates({
      ownProduct: buildOwnProductForReview(context.ownUrl),
      candidates: [],
      loading: true
    });
  }

  try {
    const payload = await fetchReviewCandidates(context, query);
    if (state.review.requestKey !== requestKey) return;
    renderReviewCandidates(payload);
  } catch (error) {
    if (state.review.requestKey !== requestKey) return;
    elements.reviewModalBody.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "Falha ao carregar candidatos.")}</div>`;
  }
}

function renderReviewCandidates(payload) {
  const own = payload.ownProduct || buildOwnProductForReview(state.review.modalContext?.ownUrl);
  const candidates = payload.candidates || [];
  const query = state.review.modalContext?.query || "";
  state.review.candidates = {};
  elements.reviewModalBody.innerHTML = `
    <div class="review-own">
      ${own.image ? `<img src="${own.image}" alt="" onerror="this.remove()">` : ""}
      <div>
        <strong>${escapeHtml(own.title)}</strong>
        <span>${escapeHtml(own.platform || "Plataforma")}</span>
        <small>Nexus: Primaria ${formatPrice(own.licenses?.primary?.price)} | Secundaria ${formatPrice(own.licenses?.secondary?.price)}</small>
      </div>
    </div>
    <form class="review-search">
      <input name="query" type="search" value="${escapeAttr(query)}" placeholder="Pesquisar no concorrente" autofocus>
      <button type="submit">Pesquisar</button>
      <button type="button" data-modal-action="missing-today">Nao tem no concorrente hoje</button>
    </form>
    <div class="candidate-list">
      ${payload.loading
        ? '<div class="empty-state">Carregando sugestoes do concorrente...</div>'
        : candidates.length ? candidates.map(renderCandidate).join("") : '<div class="empty-state">Nenhum candidato encontrado. Pesquise pelo nome usado no site do concorrente.</div>'}
    </div>
  `;
}

function renderCandidate(candidate) {
  const confidence = candidate.review?.confidence || Math.max(0, Math.min(100, Math.round(candidate.score || 0)));
  const reasons = candidate.review?.reasons?.length ? candidate.review.reasons.join(" · ") : "Candidato encontrado";
  const candidateKey = rememberModalCandidate(candidate);
  return `
    <article class="candidate-card">
      ${candidate.image ? `<img src="${candidate.image}" alt="" loading="lazy" onerror="this.remove()">` : "<span></span>"}
      <div>
        <a href="${candidate.url}" target="_blank" rel="noreferrer">${escapeHtml(candidate.title)}</a>
        <small>${escapeHtml(candidate.platform || "")}</small>
        <small>Primaria ${formatPrice(candidate.licenses?.primary?.price)} | Secundaria ${formatPrice(candidate.licenses?.secondary?.price)}</small>
        <small>IA observadora: ${confidence}% - ${escapeHtml(reasons)}</small>
      </div>
      <button type="button" data-modal-action="choose-candidate" data-candidate-key="${escapeAttr(candidateKey)}" data-candidate-url="${escapeAttr(candidate.url)}">Usar este</button>
      <button type="button" data-modal-action="reject-candidate" data-candidate-key="${escapeAttr(candidateKey)}" data-candidate-url="${escapeAttr(candidate.url)}">Nao e este</button>
    </article>
  `;
}

function rememberModalCandidate(candidate) {
  const key = candidate.url || `${candidate.title}-${Object.keys(state.review.candidates || {}).length}`;
  state.review.candidates = state.review.candidates || {};
  state.review.candidates[key] = candidate;
  return key;
}

async function handleModalAction(event) {
  const button = event.target.closest("[data-modal-action]");
  if (!button || !state.review.modalContext) return;
  const modalAction = button.dataset.modalAction;
  const action = modalAction === "choose-candidate" ? "choose" : modalAction === "missing-today" ? "missing-today" : "wrong";
  const candidate = state.review.candidates?.[button.dataset.candidateKey] || null;
  const payload = {
    ...state.review.modalContext,
    action,
    competitorUrl: button.dataset.candidateUrl || state.review.modalContext.competitorUrl || "",
    candidate
  };
  if (action === "choose" || action === "missing-today") {
    closeReviewModal();
    saveReviewDecision(payload, button);
    return;
  }
  removeRejectedCandidate(button);
  saveReviewDecision(payload, null, { optimistic: false, silent: true });
}

function handleModalSearch(event) {
  event.preventDefault();
  if (!state.review.modalContext) return;
  const data = new FormData(event.target);
  openReviewModal(state.review.modalContext, String(data.get("query") || "").trim());
}

function closeReviewModal() {
  elements.reviewModal.hidden = true;
  state.review.modalContext = null;
  state.review.requestKey = "";
}

function removeRejectedCandidate(button) {
  const card = button.closest(".candidate-card");
  if (card) card.remove();
  const key = button.dataset.candidateKey;
  if (key && state.review.candidates) delete state.review.candidates[key];
  if (!elements.reviewModalBody.querySelector(".candidate-card")) {
    const list = elements.reviewModalBody.querySelector(".candidate-list");
    if (list) list.innerHTML = '<div class="empty-state">Candidato removido. Pesquise pelo nome usado no site do concorrente.</div>';
  }
}

function reviewCandidateCacheKey(context, query = "") {
  return `${context.ownUrl || ""}::${context.competitorId || ""}::${String(query || "").trim().toLowerCase()}`;
}

function handleReviewPrefetch(event) {
  const button = event.target.closest('[data-review-action="choose"]');
  if (!button || button.dataset.prefetched === "1") return;
  button.dataset.prefetched = "1";
  const context = {
    action: "choose",
    ownUrl: button.dataset.ownUrl,
    competitorId: button.dataset.competitorId,
    competitorUrl: button.dataset.competitorUrl || ""
  };
  fetchReviewCandidates(context, "").catch(() => {});
}

async function fetchReviewCandidates(context, query = "") {
  const requestKey = reviewCandidateCacheKey(context, query);
  if (state.review.candidatesCache.has(requestKey)) return state.review.candidatesCache.get(requestKey);
  if (state.review.candidateRequests.has(requestKey)) return state.review.candidateRequests.get(requestKey);

  const params = new URLSearchParams({
    ownUrl: context.ownUrl,
    competitorId: context.competitorId,
    limit: query ? "12" : "8",
    query
  });
  const request = fetch(`/api/review-candidates?${params}`, { cache: "no-store" })
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Nao consegui carregar candidatos");
      state.review.candidatesCache.set(requestKey, payload);
      return payload;
    })
    .finally(() => state.review.candidateRequests.delete(requestKey));
  state.review.candidateRequests.set(requestKey, request);
  return request;
}

function buildOwnProductForReview(ownUrl) {
  const item = (state.report.items || []).find((product) => product.url === ownUrl);
  return {
    url: item?.url || ownUrl || "",
    title: item?.title || "Produto Nexus",
    image: item?.image || "",
    platform: item?.platform || "",
    licenses: {
      primary: { price: item?.licenses?.primary?.myPrice ?? null },
      secondary: { price: item?.licenses?.secondary?.myPrice ?? null }
    }
  };
}

async function loadSavedReport() {
  try {
    const response = await fetch("/api/report", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.report?.items) {
      state.report = applyStoredReviewDecisions(payload.report);
      invalidateEntries();
      storeReport(state.report);
    }
    state.remoteStatus = payload.status || null;
    render();
  } catch {
    renderSyncStatus();
  }
}

async function triggerWorkerRun() {
  const confirmed = window.confirm("Esta acao inicia uma coleta no Render. Cada execucao pode gerar cobranca. Deseja continuar?");
  if (!confirmed) return;

  elements.runWorkerButton.disabled = true;
  elements.runWorkerButton.textContent = "Iniciando...";
  elements.syncStatus.textContent = "Solicitando coleta";
  elements.syncDetails.textContent = "Aguarde alguns segundos para o Render iniciar.";

  try {
    const response = await fetch("/api/trigger-refresh", { method: "POST" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Nao consegui iniciar a coleta");
    elements.syncStatus.textContent = "Coleta iniciada";
    elements.syncDetails.textContent = "O progresso aparecera aqui enquanto o worker salvar os lotes.";
    setTimeout(loadSavedReport, 5000);
  } catch (error) {
    elements.syncStatus.textContent = "Falha ao iniciar coleta";
    elements.syncDetails.textContent = error.message || "Tente novamente pelo painel do Render.";
  } finally {
    elements.runWorkerButton.disabled = false;
    elements.runWorkerButton.textContent = "Executar coleta";
  }
}

function renderSyncStatus() {
  const status = state.remoteStatus;
  const total = status?.totalItems || state.report.totalItems || state.report.items?.length || 0;
  const done = status?.offset ?? state.report.items?.length ?? 0;
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  elements.syncProgress.style.width = `${percent}%`;

  if (status?.status === "running") {
    elements.syncStatus.textContent = isStaleStatus(status) ? "Coleta parcial salva" : "Atualizacao em andamento";
    elements.syncDetails.textContent = `${done} de ${total} itens processados`;
    return;
  }
  if (status?.status === "error") {
    elements.syncStatus.textContent = "Ultima atualizacao falhou";
    elements.syncDetails.textContent = status.message || "Verifique o worker de coleta.";
    return;
  }
  if (state.report.items?.length) {
    elements.syncStatus.textContent = "Dados atualizados";
    elements.syncDetails.textContent = `${state.report.items.length} itens salvos - ${formatDate(state.report.generatedAt)}`;
    elements.syncProgress.style.width = "100%";
    return;
  }
  elements.syncStatus.textContent = "Aguardando primeira coleta";
  elements.syncDetails.textContent = "O worker diario vai preencher esta base automaticamente.";
}

function findCompetitor(id) {
  return competitors.find((competitor) => competitor.id === id);
}

function valueOrInfinity(value) {
  return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
}

function valueOrNegativeInfinity(value) {
  return typeof value === "number" ? value : Number.NEGATIVE_INFINITY;
}

function formatPrice(value) {
  return typeof value === "number" ? money.format(value) : "Sem preco";
}

function formatDiff(value) {
  if (typeof value !== "number") return "Sem base";
  const sign = value > 0 ? "+" : "";
  return `${sign}${money.format(value)}`;
}

function diffClass(value) {
  if (typeof value !== "number") return "neutral";
  if (Math.abs(value) <= state.threshold) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleString("pt-BR");
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isStaleStatus(status) {
  const date = new Date(status.updatedAt || status.startedAt || 0);
  return Number.isFinite(date.getTime()) && Date.now() - date.getTime() > 60 * 60 * 1000;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

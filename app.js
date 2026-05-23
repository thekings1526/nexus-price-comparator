const competitors = [
  { id: "mex", name: "Mex" },
  { id: "rafa", name: "Rafa" },
  { id: "ngcp", name: "NGCP" },
  { id: "coelho", name: "Coelho" }
];

const APP_SCHEMA_VERSION = 4;

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
  refreshTimer: null,
  review: {
    modalContext: null,
    loading: false
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

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    render();
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
    render();
  });

  elements.runWorkerButton.addEventListener("click", triggerWorkerRun);
  elements.rows.addEventListener("click", handleReviewAction);
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
  return (state.report.items || []).flatMap((item) => (
    Object.entries(item.licenses || {}).map(([license, payload]) => {
      const competitorPrices = Object.entries(payload.competitors || {})
        .map(([id, value]) => ({ id, ...value }))
        .filter((value) => typeof value.price === "number");
      const best = competitorPrices.slice().sort((a, b) => a.price - b.price)[0] || null;
      const diff = best && typeof payload.myPrice === "number" ? payload.myPrice - best.price : null;
      return {
        item,
        license,
        myPrice: payload.myPrice,
        competitorData: payload.competitors || {},
        best,
        diff,
        status: classify(diff, best)
      };
    })
  ));
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
  return `${entry.item.title} ${entry.item.platform}`.toLowerCase().includes(state.search);
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
  const counts = {
    expensive: entries.filter((entry) => entry.status === "expensive").length,
    close: entries.filter((entry) => entry.status === "close").length,
    cheaper: entries.filter((entry) => entry.status === "cheaper").length,
    missing: entries.filter((entry) => entry.status === "missing").length
  };
  elements.summaryGrid.innerHTML = `
    <article class="metric metric-risk"><b>${counts.expensive}</b><span>Nexus mais caro</span></article>
    <article class="metric metric-aligned"><b>${counts.close}</b><span>Preco alinhado</span></article>
    <article class="metric metric-advantage"><b>${counts.cheaper}</b><span>Nexus mais barato</span></article>
    <article class="metric metric-missing"><b>${counts.missing}</b><span>Sem referencia</span></article>
  `;
}

function renderRows(entries) {
  elements.resultsCount.textContent = `${entries.length} ${entries.length === 1 ? "resultado" : "resultados"}`;
  elements.boardMeta.textContent = state.report.generatedAt
    ? `Atualizado em ${formatDate(state.report.generatedAt)}`
    : "Aguardando dados";

  if (!entries.length) {
    elements.rows.innerHTML = '<div class="empty-state">Nenhum produto encontrado com os filtros atuais.</div>';
    return;
  }

  elements.rows.innerHTML = entries.map((entry) => {
    const licenseLabel = entry.license === "primary" ? "Primaria" : "Secundaria";
    const licenseClass = entry.license === "primary" ? "license-primary" : "license-secondary";
    const statusLabel = {
      expensive: "Acima do mercado",
      close: "Preco alinhado",
      cheaper: "Abaixo do mercado",
      missing: "Sem referencia"
    }[entry.status];

    return `
      <article class="price-row status-row-${entry.status}">
        <div class="game-cell">
          ${entry.item.image ? `<img src="${entry.item.image}" alt="" loading="lazy" onerror="this.remove()">` : `<img alt="">`}
          <div>
            <a class="game-title" href="${entry.item.url || "#"}" target="_blank" rel="noreferrer">${escapeHtml(entry.item.title)}</a>
            <div class="game-meta">
              <span>${entry.item.platform || "Plataforma"}</span>
              <span class="status-tag status-${entry.status}">${statusLabel}</span>
            </div>
          </div>
        </div>
        <div class="cell-stack">
          <span class="cell-label">Licenca</span>
          <span class="tag ${licenseClass}">${licenseLabel}</span>
        </div>
        <div class="cell-stack">
          <span class="cell-label">Nexus</span>
          <strong class="money">${formatPrice(entry.myPrice)}</strong>
        </div>
        <div class="cell-stack">
          <span class="cell-label">Melhor concorrente</span>
          <strong class="money">${entry.best ? formatPrice(entry.best.price) : "Sem preco"}</strong>
          ${entry.best ? `<small>${findCompetitor(entry.best.id)?.name || entry.best.id}</small>` : ""}
        </div>
        <div class="cell-stack">
          <span class="cell-label">Variacao</span>
          <strong class="money diff ${diffClass(entry.diff)}">${formatDiff(entry.diff)}</strong>
        </div>
        <div class="competitor-area">
          <span class="cell-label">Concorrentes</span>
          <div class="competitors">${renderCompetitors(entry)}</div>
        </div>
      </article>
    `;
  }).join("");
}

function renderCompetitors(entry) {
  return competitors.map((competitor) => {
    const value = entry.competitorData[competitor.id];
    const bestClass = entry.best?.id === competitor.id ? " best" : "";
    const missingClass = value?.price ? "" : " missing";
    const note = value?.available === false ? "Indisponivel" : (entry.best?.id === competitor.id ? "Menor preco" : "");
    const review = value?.review;
    const reviewClass = review?.status ? ` review-${review.status}` : "";
    const reviewText = review ? `${review.label} (${review.confidence}%)` : "IA: sem leitura";
    const confirmed = review?.status === "confirmed";
    const actionMarkup = confirmed ? "" : `
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
      <strong>${value?.price ? formatPrice(value.price) : "Sem preco"}</strong>
      ${note ? `<small>${note}</small>` : ""}
      <small class="review-pill${reviewClass}">${escapeHtml(reviewText)}</small>
      ${actionMarkup}
    `;
    return `<div class="competitor${bestClass}${missingClass}">
      ${content}
    </div>`;
  }).join("");
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

  await saveReviewDecision(payload, button);
}

async function saveReviewDecision(payload, button) {
  const original = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Salvando";
  }
  try {
    const response = await fetch("/api/review-decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Nao consegui salvar");
    applyLocalReviewDecision(payload);
    render();
    if (button) button.textContent = "Salvo";
    setTimeout(loadSavedReport, 900);
  } catch (error) {
    window.alert(error.message || "Nao consegui salvar a revisao.");
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
  if (payload.action === "wrong") return;
  const item = (state.report.items || []).find((product) => product.url === payload.ownUrl);
  if (!item) return;
  Object.values(item.licenses || {}).forEach((license) => {
    const competitor = license.competitors?.[payload.competitorId];
    if (!competitor) return;
    competitor.review = {
      ...(competitor.review || {}),
      status: payload.action === "missing-today" ? "missing-today" : "confirmed",
      confidence: payload.action === "missing-today" ? 1 : 100,
      label: payload.action === "missing-today" ? "Sem produto hoje" : "Confirmado por voce",
      reasons: payload.action === "missing-today" ? ["Marcado como ausente nesta revisao"] : ["Vinculo salvo manualmente"]
    };
    if (payload.action === "choose" && payload.competitorUrl) competitor.url = payload.competitorUrl;
  });
  storeReport(state.report);
}

async function openReviewModal(context, query = "") {
  state.review.modalContext = { ...context, query };
  elements.reviewModal.hidden = false;
  elements.reviewModalTitle.textContent = `${findCompetitor(context.competitorId)?.name || context.competitorId}: corrigir vinculo`;
  elements.reviewModalBody.innerHTML = '<div class="empty-state">Carregando candidatos...</div>';

  try {
    const params = new URLSearchParams({
      ownUrl: context.ownUrl,
      competitorId: context.competitorId,
      limit: "14",
      query
    });
    const response = await fetch(`/api/review-candidates?${params}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Nao consegui carregar candidatos");
    renderReviewCandidates(payload);
  } catch (error) {
    elements.reviewModalBody.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "Falha ao carregar candidatos.")}</div>`;
  }
}

function renderReviewCandidates(payload) {
  const own = payload.ownProduct;
  const candidates = payload.candidates || [];
  const query = state.review.modalContext?.query || "";
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
      ${candidates.length ? candidates.map(renderCandidate).join("") : '<div class="empty-state">Nenhum candidato encontrado. Pesquise pelo nome usado no site do concorrente.</div>'}
    </div>
  `;
}

function renderCandidate(candidate) {
  const confidence = candidate.review?.confidence || Math.max(0, Math.min(100, Math.round(candidate.score || 0)));
  const reasons = candidate.review?.reasons?.length ? candidate.review.reasons.join(" · ") : "Candidato encontrado";
  return `
    <article class="candidate-card">
      ${candidate.image ? `<img src="${candidate.image}" alt="" loading="lazy" onerror="this.remove()">` : "<span></span>"}
      <div>
        <a href="${candidate.url}" target="_blank" rel="noreferrer">${escapeHtml(candidate.title)}</a>
        <small>${escapeHtml(candidate.platform || "")}</small>
        <small>Primaria ${formatPrice(candidate.licenses?.primary?.price)} | Secundaria ${formatPrice(candidate.licenses?.secondary?.price)}</small>
        <small>IA observadora: ${confidence}% - ${escapeHtml(reasons)}</small>
      </div>
      <button type="button" data-modal-action="choose-candidate" data-candidate-url="${escapeAttr(candidate.url)}">Usar este</button>
      <button type="button" data-modal-action="reject-candidate" data-candidate-url="${escapeAttr(candidate.url)}">Nao e este</button>
    </article>
  `;
}

async function handleModalAction(event) {
  const button = event.target.closest("[data-modal-action]");
  if (!button || !state.review.modalContext) return;
  const modalAction = button.dataset.modalAction;
  const action = modalAction === "choose-candidate" ? "choose" : modalAction === "missing-today" ? "missing-today" : "wrong";
  await saveReviewDecision({
    ...state.review.modalContext,
    action,
    competitorUrl: button.dataset.candidateUrl || state.review.modalContext.competitorUrl || ""
  }, button);
  if (action === "choose" || action === "missing-today") closeReviewModal();
  if (action === "wrong") openReviewModal(state.review.modalContext, state.review.modalContext.query || "");
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
}

async function loadSavedReport() {
  try {
    const response = await fetch("/api/report", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    if (payload.report?.items) {
      state.report = payload.report;
      storeReport(payload.report);
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

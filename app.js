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
  refreshTimer: null
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const elements = {
  rows: document.querySelector("#rows"),
  summaryGrid: document.querySelector("#summaryGrid"),
  syncStatus: document.querySelector("#syncStatus"),
  syncDetails: document.querySelector("#syncDetails"),
  syncProgress: document.querySelector("#syncProgress"),
  searchInput: document.querySelector("#searchInput"),
  statusSelect: document.querySelector("#statusSelect"),
  licenseSelect: document.querySelector("#licenseSelect"),
  sortSelect: document.querySelector("#sortSelect"),
  thresholdInput: document.querySelector("#thresholdInput")
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
    <article class="metric metric-aligned"><b>${counts.close}</b><span>Mesmo preco ou proximo</span></article>
    <article class="metric metric-advantage"><b>${counts.cheaper}</b><span>Nexus mais barato</span></article>
    <article class="metric metric-missing"><b>${counts.missing}</b><span>Sem preco confiavel</span></article>
  `;
}

function renderRows(entries) {
  if (!entries.length) {
    elements.rows.innerHTML = '<div class="empty-state">Nenhum produto encontrado com os filtros atuais.</div>';
    return;
  }

  elements.rows.innerHTML = entries.map((entry) => {
    const licenseLabel = entry.license === "primary" ? "Primaria" : "Secundaria";
    const licenseClass = entry.license === "primary" ? "license-primary" : "license-secondary";
    const statusLabel = {
      expensive: "Nexus mais caro",
      close: "Preco proximo",
      cheaper: "Nexus mais barato",
      missing: "Sem base"
    }[entry.status];

    return `
      <article class="price-row">
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
        <div><span class="tag ${licenseClass}">${licenseLabel}</span></div>
        <div class="money">${formatPrice(entry.myPrice)}</div>
        <div>
          <strong>${entry.best ? formatPrice(entry.best.price) : "Sem preco"}</strong>
          ${entry.best ? `<div class="game-meta">${findCompetitor(entry.best.id)?.name || entry.best.id}</div>` : ""}
        </div>
        <div class="money diff ${diffClass(entry.diff)}">${formatDiff(entry.diff)}</div>
        <div class="competitors">${renderCompetitors(entry)}</div>
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
    const content = `
      <span class="competitor-name">${competitor.name}</span>
      <strong>${value?.price ? formatPrice(value.price) : "Sem preco"}</strong>
      ${note ? `<small>${note}</small>` : ""}
    `;
    if (value?.url) {
      return `<a class="competitor${bestClass}${missingClass}" href="${value.url}" target="_blank" rel="noreferrer">${content}</a>`;
    }
    return `<span class="competitor${bestClass}${missingClass}">${content}</span>`;
  }).join("");
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

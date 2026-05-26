const {
  buildReport,
  discoverCompetitorCatalogs,
  discoverOwnProducts,
  getSavedReport,
  getReviewOverrides,
  getRefreshControl,
  saveCatalogItems,
  saveReportWithStatus,
  COMPETITORS
} = require("../netlify/functions/refresh-prices");

const BATCH_SIZE = Math.max(Number(process.env.WORKER_BATCH_SIZE) || 1, 1);
const ITEM_RETRIES = Math.max(Number(process.env.WORKER_ITEM_RETRIES) || 3, 1);
const RESUME_ENABLED = process.env.WORKER_RESUME === "1";
const SAVE_EVERY = Math.max(Number(process.env.WORKER_SAVE_EVERY) || 5, 1);
const COMPETITOR_IDS = (process.env.WORKER_COMPETITORS || COMPETITORS.map((item) => item.id).join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

async function main() {
  const startedAt = new Date().toISOString();
  const control = await getRefreshControl().catch(() => null);
  const runMode = requestedRunMode(control);
  const previous = await baseReport();
  await saveReportWithStatus(previous, {
    status: "running",
    startedAt,
    mode: runMode,
    offset: previous.items?.length || 0,
    totalItems: previous.totalItems || 0,
    message: "Lendo catalogo da Nexus"
  });

  const catalogItems = await discoverOwnProducts(Number.POSITIVE_INFINITY);
  await saveCatalogItems(catalogItems);
  await assertRefreshNotStopped({
    startedAt,
    report: previous,
    offset: previous.items?.length || 0,
    totalItems: catalogItems.length
  });

  const selectedCompetitors = COMPETITORS.filter((item) => COMPETITOR_IDS.includes(item.id));
  await saveReportWithStatus(emptyReport(catalogItems.length, selectedCompetitors), {
    status: "running",
    startedAt,
    mode: runMode,
    offset: 0,
    totalItems: catalogItems.length,
    message: "Lendo catalogos dos concorrentes"
  });

  const competitorCatalogs = await discoverCompetitorCatalogs(selectedCompetitors);
  await assertRefreshNotStopped({
    startedAt,
    report: previous,
    offset: 0,
    totalItems: catalogItems.length
  });
  const reviewOverrides = await getReviewOverrides().catch(() => null);
  const catalogSummary = Array.from(competitorCatalogs.entries())
    .map(([id, items]) => `${id}: ${items.length}`)
    .join(", ");

  const resume = shouldResumeForMode(previous, catalogItems.length, runMode);
  let merged = resume ? previous : emptyReport(catalogItems.length, selectedCompetitors);
  const processedKeys = new Set((merged.items || []).map(reportItemKey).filter(Boolean));
  const itemsToProcess = resume
    ? catalogItems.filter((item) => !processedKeys.has(catalogItemKey(item)))
    : catalogItems;
  const startOffset = resume ? catalogItems.length - itemsToProcess.length : 0;

  if (startOffset > 0) {
    await saveReportWithStatus(merged, {
      status: "running",
      startedAt,
      mode: runMode,
      offset: startOffset,
      totalItems: catalogItems.length,
      items: merged.items.length,
      message: `Retomando comparação. Catálogos: ${catalogSummary}`
    });
  }

  const parsedCompetitorCache = new Map();
  const ownProductCache = new Map();
  const batch = await buildReportWithRetry({
    catalogItems: itemsToProcess,
    startedAt,
    competitorCatalogs,
    parsedCompetitorCache,
    ownProductCache,
    reviewOverrides,
    selectedCompetitors,
    runMode,
    startOffset,
    totalItems: catalogItems.length,
    previous: merged,
    catalogSummary
  });

  merged = mergeReports(merged, batch);
  merged.generatedAt = new Date().toISOString();
  await saveReportWithStatus(merged, {
    status: "ready",
    startedAt,
    mode: runMode,
    finishedAt: new Date().toISOString(),
    offset: catalogItems.length,
    batchSize: BATCH_SIZE,
    totalItems: catalogItems.length,
    items: merged.items.length,
    message: "Atualização diária finalizada"
  });
}

function emptyReport(totalItems, competitors) {
  return {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    source: "worker",
    competitors,
    totalItems,
    items: []
  };
}

function shouldResume(previous, totalItems) {
  return RESUME_ENABLED
    && previous
    && previous.totalItems === totalItems
    && Array.isArray(previous.items)
    && previous.items.length > 0
    && previous.items.length < totalItems;
}

function shouldResumeForMode(previous, totalItems, runMode) {
  if (runMode === "restart") return false;
  if (runMode === "resume") return canResume(previous, totalItems);
  return shouldResume(previous, totalItems);
}

function canResume(previous, totalItems) {
  return previous
    && previous.totalItems === totalItems
    && Array.isArray(previous.items)
    && previous.items.length > 0
    && previous.items.length < totalItems;
}

async function buildReportWithRetry(context) {
  let lastError;
  for (let attempt = 1; attempt <= ITEM_RETRIES; attempt += 1) {
    try {
      return await buildReport({
        competitors: COMPETITOR_IDS,
        items: context.catalogItems,
        limit: "all",
        competitorCatalogs: context.competitorCatalogs,
        parsedCompetitorCache: context.parsedCompetitorCache,
        ownProductCache: context.ownProductCache,
        reviewOverrides: context.reviewOverrides,
        refreshReviewOverridesPerItem: true,
        onItem: async ({ items }) => {
          const offset = context.startOffset + items.length;
          let partial = mergeReports(context.previous, {
            generatedAt: new Date().toISOString(),
            competitors: context.selectedCompetitors,
            totalItems: context.totalItems,
            items
          });
          await assertRefreshNotStopped({
            startedAt: context.startedAt,
            report: partial,
            offset,
            totalItems: context.totalItems,
            batchSize: BATCH_SIZE
          });
          if (offset % SAVE_EVERY !== 0 && offset < context.totalItems) return;
          partial = await preserveManualReportEdits(partial, context.startedAt);
          await saveReportWithStatus(partial, {
            status: "running",
            startedAt: context.startedAt,
            mode: context.runMode,
            offset,
            batchSize: BATCH_SIZE,
            totalItems: context.totalItems,
            items: partial.items.length,
            message: `Comparando produtos. Catalogos: ${context.catalogSummary}`
          });
          console.log(`Atualizados ${offset} de ${context.totalItems}`);
        }
      });
    } catch (error) {
      if (error?.stopRequested) throw error;
      lastError = error;
      await saveReportWithStatus(await baseReport(), {
        status: "running",
        startedAt: context.startedAt,
        offset: context.startOffset,
        batchSize: BATCH_SIZE,
        totalItems: context.totalItems,
        message: `Tentativa ${attempt}/${ITEM_RETRIES} falhou durante a comparação`
      }).catch(() => null);
      await sleep(retryDelay(attempt));
    }
  }
  throw new Error(`Coleta parada durante a comparação. Causa: ${lastError?.message || lastError}`);
}

async function preserveManualReportEdits(partial, startedAt) {
  const latest = await getSavedReport().catch(() => null);
  if (!latest?.items?.length || !partial?.items?.length) return partial;
  const manualSinceStart = new Date(startedAt || 0).getTime();
  const latestByKey = new Map((latest.items || []).map((item) => [reportItemKey(item), item]));
  for (const item of partial.items || []) {
    const latestItem = latestByKey.get(reportItemKey(item));
    if (!latestItem) continue;
    preserveManualCompetitorCells(item, latestItem, manualSinceStart);
  }
  return partial;
}

function preserveManualCompetitorCells(targetItem, latestItem, manualSinceStart) {
  for (const [licenseKey, latestLicense] of Object.entries(latestItem.licenses || {})) {
    const targetLicense = targetItem.licenses?.[licenseKey];
    if (!targetLicense) continue;
    targetLicense.competitors = targetLicense.competitors || {};
    for (const [competitorId, latestCell] of Object.entries(latestLicense.competitors || {})) {
      if (!isManualReviewCellSince(latestCell, manualSinceStart)) continue;
      targetLicense.competitors[competitorId] = latestCell;
    }
  }
}

function isManualReviewCellSince(cell, manualSinceStart) {
  const status = cell?.review?.status;
  if (!["confirmed", "missing-today", "wrong"].includes(status)) return false;
  const updatedAt = new Date(cell?.review?.updatedAt || 0).getTime();
  return Number.isFinite(updatedAt) && updatedAt >= manualSinceStart;
}

class StopRefreshError extends Error {
  constructor(message) {
    super(message);
    this.stopRequested = true;
  }
}

function requestedRunMode(control) {
  if (control?.mode === "restart") return "restart";
  if (control?.mode === "resume") return "resume";
  return "auto";
}

async function assertRefreshNotStopped(context) {
  const control = await getRefreshControl().catch(() => null);
  if (!shouldStopForControl(control, context.startedAt)) return;
  await saveReportWithStatus(context.report, {
    status: "paused",
    startedAt: context.startedAt,
    pausedAt: new Date().toISOString(),
    offset: context.offset,
    batchSize: context.batchSize || BATCH_SIZE,
    totalItems: context.totalItems,
    items: context.report?.items?.length || 0,
    message: control.action === "restart"
      ? "Coleta pausada para reiniciar do zero."
      : "Coleta pausada. O progresso foi salvo."
  });
  throw new StopRefreshError("Coleta pausada por solicitacao do painel");
}

function shouldStopForControl(control, startedAt) {
  if (!control?.requestedAt || !startedAt) return false;
  const requestedAt = new Date(control.requestedAt).getTime();
  const workerStartedAt = new Date(startedAt).getTime();
  if (!Number.isFinite(requestedAt) || !Number.isFinite(workerStartedAt)) return false;
  if (requestedAt <= workerStartedAt) return false;
  return control.action === "stop" || control.action === "restart";
}

function retryDelay(attempt) {
  return Math.min(90000, 8000 * attempt);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function baseReport() {
  const previous = await getSavedReport().catch(() => null);
  return previous || {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    source: "worker",
    competitors: COMPETITORS.filter((item) => COMPETITOR_IDS.includes(item.id)),
    totalItems: 0,
    items: []
  };
}

function mergeReports(previous, batch) {
  const byProductUrl = new Map((previous.items || []).map((item) => [reportItemKey(item), item]));
  for (const item of batch.items || []) byProductUrl.set(reportItemKey(item), item);
  return {
    ...previous,
    generatedAt: batch.generatedAt,
    competitors: batch.competitors,
    totalItems: batch.totalItems,
    items: Array.from(byProductUrl.values())
  };
}

function reportItemKey(item) {
  return normalizeReportUrl(item?.url) || item?.id || "";
}

function catalogItemKey(item) {
  return normalizeReportUrl(item?.url) || item?.id || "";
}

function normalizeReportUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim();
  }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error);
    if (error?.stopRequested) process.exit(0);
    await saveReportWithStatus(await baseReport(), {
      status: "error",
      failedAt: new Date().toISOString(),
      message: error.message || "Erro na atualização diária"
    }).catch(() => null);
    process.exit(1);
  });
}

module.exports = { main };

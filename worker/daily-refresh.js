const {
  buildReport,
  discoverCompetitorCatalogs,
  discoverOwnProducts,
  getSavedReport,
  getReviewOverrides,
  saveCatalogItems,
  saveReportWithStatus,
  COMPETITORS
} = require("../netlify/functions/refresh-prices");

const BATCH_SIZE = Math.max(Number(process.env.WORKER_BATCH_SIZE) || 1, 1);
const ITEM_RETRIES = Math.max(Number(process.env.WORKER_ITEM_RETRIES) || 1, 1);
const RESUME_ENABLED = process.env.WORKER_RESUME === "1";
const SAVE_EVERY = Math.max(Number(process.env.WORKER_SAVE_EVERY) || 5, 1);
const COMPETITOR_IDS = (process.env.WORKER_COMPETITORS || COMPETITORS.map((item) => item.id).join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

async function main() {
  const startedAt = new Date().toISOString();
  const previous = await baseReport();
  await saveReportWithStatus(previous, {
    status: "running",
    startedAt,
    offset: previous.items?.length || 0,
    totalItems: previous.totalItems || 0,
    message: "Lendo catalogo da Nexus"
  });

  const catalogItems = await discoverOwnProducts(Number.POSITIVE_INFINITY);
  await saveCatalogItems(catalogItems);

  const selectedCompetitors = COMPETITORS.filter((item) => COMPETITOR_IDS.includes(item.id));
  await saveReportWithStatus(emptyReport(catalogItems.length, selectedCompetitors), {
    status: "running",
    startedAt,
    offset: 0,
    totalItems: catalogItems.length,
    message: "Lendo catalogos dos concorrentes"
  });

  const competitorCatalogs = await discoverCompetitorCatalogs(selectedCompetitors);
  const reviewOverrides = await getReviewOverrides().catch(() => null);
  const catalogSummary = Array.from(competitorCatalogs.entries())
    .map(([id, items]) => `${id}: ${items.length}`)
    .join(", ");

  let merged = shouldResume(previous, catalogItems.length) ? previous : emptyReport(catalogItems.length, selectedCompetitors);
  const startOffset = Math.min(merged.items?.length || 0, catalogItems.length);
  const itemsToProcess = catalogItems.slice(startOffset);

  if (startOffset > 0) {
    await saveReportWithStatus(merged, {
      status: "running",
      startedAt,
      offset: startOffset,
      totalItems: catalogItems.length,
      items: merged.items.length,
      message: `Retomando comparacao. Catalogos: ${catalogSummary}`
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
    finishedAt: new Date().toISOString(),
    offset: catalogItems.length,
    batchSize: BATCH_SIZE,
    totalItems: catalogItems.length,
    items: merged.items.length,
    message: "Atualizacao diaria finalizada"
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
        onItem: async ({ items }) => {
          const offset = context.startOffset + items.length;
          if (offset % SAVE_EVERY !== 0 && offset < context.totalItems) return;
          const partial = mergeReports(context.previous, {
            generatedAt: new Date().toISOString(),
            competitors: context.selectedCompetitors,
            totalItems: context.totalItems,
            items
          });
          await saveReportWithStatus(partial, {
            status: "running",
            startedAt: context.startedAt,
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
      lastError = error;
      await saveReportWithStatus(await baseReport(), {
        status: "running",
        startedAt: context.startedAt,
        offset: context.startOffset,
        batchSize: BATCH_SIZE,
        totalItems: context.totalItems,
        message: `Tentativa ${attempt}/${ITEM_RETRIES} falhou durante a comparacao`
      }).catch(() => null);
      await sleep(retryDelay(attempt));
    }
  }
  throw new Error(`Coleta parada durante a comparacao. Causa: ${lastError?.message || lastError}`);
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
  const byId = new Map((previous.items || []).map((item) => [item.id, item]));
  for (const item of batch.items || []) byId.set(item.id, item);
  return {
    ...previous,
    generatedAt: batch.generatedAt,
    competitors: batch.competitors,
    totalItems: batch.totalItems,
    items: Array.from(byId.values())
  };
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error);
    await saveReportWithStatus(await baseReport(), {
      status: "error",
      failedAt: new Date().toISOString(),
      message: error.message || "Erro na atualizacao diaria"
    }).catch(() => null);
    process.exit(1);
  });
}

module.exports = { main };

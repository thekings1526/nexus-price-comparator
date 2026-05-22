const {
  buildReport,
  discoverOwnProducts,
  getSavedReport,
  saveCatalogItems,
  saveReportWithStatus,
  COMPETITORS
} = require("../netlify/functions/refresh-prices");

const BATCH_SIZE = Math.max(Number(process.env.WORKER_BATCH_SIZE) || 1, 1);
const ITEM_RETRIES = Math.max(Number(process.env.WORKER_ITEM_RETRIES) || 1, 1);
const RESUME_ENABLED = process.env.WORKER_RESUME === "1";
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

  let merged = shouldResume(previous, catalogItems.length) ? previous : {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    source: "worker",
    competitors: COMPETITORS.filter((item) => COMPETITOR_IDS.includes(item.id)),
    totalItems: catalogItems.length,
    items: []
  };
  const startOffset = Math.min(merged.items?.length || 0, catalogItems.length);

  for (let offset = startOffset; offset < catalogItems.length; offset += BATCH_SIZE) {
    const batch = await buildReportWithRetry(catalogItems, offset, startedAt);

    merged = mergeReports(merged, batch);
    await saveReportWithStatus(merged, {
      status: "running",
      startedAt,
      offset: Math.min(offset + BATCH_SIZE, catalogItems.length),
      batchSize: BATCH_SIZE,
      totalItems: catalogItems.length,
      items: merged.items.length,
      message: "Atualizacao diaria em andamento"
    });

    console.log(`Atualizados ${Math.min(offset + BATCH_SIZE, catalogItems.length)} de ${catalogItems.length}`);
  }

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

function shouldResume(previous, totalItems) {
  return RESUME_ENABLED
    && previous
    && previous.totalItems === totalItems
    && Array.isArray(previous.items)
    && previous.items.length > 0
    && previous.items.length < totalItems;
}

async function buildReportWithRetry(catalogItems, offset, startedAt) {
  let lastError;
  for (let attempt = 1; attempt <= ITEM_RETRIES; attempt += 1) {
    try {
      return await buildReport({
        competitors: COMPETITOR_IDS,
        items: catalogItems,
        limit: "all",
        offset,
        batchSize: BATCH_SIZE
      });
    } catch (error) {
      lastError = error;
      await saveReportWithStatus(await baseReport(), {
        status: "running",
        startedAt,
        offset,
        batchSize: BATCH_SIZE,
        totalItems: catalogItems.length,
        message: `Tentativa ${attempt}/${ITEM_RETRIES} falhou no lote ${offset + 1}`
      }).catch(() => null);
      await sleep(retryDelay(attempt));
    }
  }
  const tracked = catalogItems[offset];
  const label = tracked?.text || tracked?.url || `item ${offset + 1}`;
  throw new Error(`Coleta parada no produto ${offset + 1}/${catalogItems.length}: ${label}. Causa: ${lastError?.message || lastError}`);
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

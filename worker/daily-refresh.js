const {
  buildReport,
  discoverOwnProducts,
  getSavedReport,
  saveCatalogItems,
  saveReportWithStatus,
  COMPETITORS
} = require("../netlify/functions/refresh-prices");

const BATCH_SIZE = Math.max(Number(process.env.WORKER_BATCH_SIZE) || 4, 1);
const COMPETITOR_IDS = (process.env.WORKER_COMPETITORS || COMPETITORS.map((item) => item.id).join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

async function main() {
  const startedAt = new Date().toISOString();
  await saveReportWithStatus(await baseReport(), {
    status: "running",
    startedAt,
    offset: 0,
    totalItems: 0,
    message: "Lendo catalogo da Nexus"
  });

  const catalogItems = await discoverOwnProducts(Number.POSITIVE_INFINITY);
  await saveCatalogItems(catalogItems);

  let merged = {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    source: "worker",
    competitors: COMPETITORS.filter((item) => COMPETITOR_IDS.includes(item.id)),
    totalItems: catalogItems.length,
    items: []
  };

  for (let offset = 0; offset < catalogItems.length; offset += BATCH_SIZE) {
    const batch = await buildReport({
      competitors: COMPETITOR_IDS,
      items: catalogItems,
      limit: "all",
      offset,
      batchSize: BATCH_SIZE
    });

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

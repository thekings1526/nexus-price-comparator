const {
  buildReport,
  discoverOwnProducts,
  getCatalogItems,
  getSavedReport,
  saveCatalogItems,
  saveReportWithStatus,
  setRefreshStatus
} = require("./refresh-prices");

exports.handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const offset = Math.max(Number(body.offset) || 0, 0);
    const batchSize = Math.min(Math.max(Number(body.batchSize) || 2, 1), 20);
    const startedAt = body.startedAt || new Date().toISOString();

    await setRefreshStatus({
      status: "running",
      startedAt,
      offset,
      batchSize,
      message: "Atualização completa em lotes"
    });

    const catalogItems = offset === 0
      ? await discoverOwnProducts(Number.POSITIVE_INFINITY)
      : await getCatalogItems().catch(() => []);
    const items = catalogItems.length ? catalogItems : await discoverOwnProducts(Number.POSITIVE_INFINITY);
    if (offset === 0 || !catalogItems.length) await saveCatalogItems(items);

    const batch = await buildReport({
      competitors: body.competitors,
      items,
      limit: "all",
      offset,
      batchSize
    });

    const previous = offset > 0 ? await getSavedReport().catch(() => null) : null;
    const merged = mergeReports(previous, batch, offset === 0);
    const processed = Math.min(batchSize, Math.max(batch.totalItems - offset, 0));
    const nextOffset = offset + processed;
    const done = nextOffset >= batch.totalItems || processed === 0;

    await saveReportWithStatus(merged, {
      status: done ? "ready" : "running",
      startedAt,
      finishedAt: done ? new Date().toISOString() : undefined,
      offset: nextOffset,
      batchSize,
      totalItems: batch.totalItems,
      items: merged.items.length,
      message: done ? "Atualização completa finalizada" : "Atualização completa em andamento"
    });

    return json({
      done,
      nextOffset,
      processed,
      totalItems: batch.totalItems,
      report: merged
    });
  } catch (error) {
    await setRefreshStatus({
      status: "error",
      failedAt: new Date().toISOString(),
      message: error.message || "Erro ao atualizar lote"
    }).catch(() => null);
    return json({ error: error.message || "Erro ao atualizar lote" }, 500);
  }
};

function mergeReports(previous, batch, reset) {
  const base = reset || !previous ? {
    ...batch,
    items: []
  } : {
    ...previous,
    generatedAt: batch.generatedAt,
    competitors: batch.competitors,
    totalItems: batch.totalItems
  };

  const byId = new Map(base.items.map((item) => [item.id, item]));
  for (const item of batch.items) byId.set(item.id, item);
  return {
    ...base,
    source: "saved",
    schemaVersion: batch.schemaVersion,
    items: Array.from(byId.values())
  };
}

function json(payload, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(payload)
  };
}

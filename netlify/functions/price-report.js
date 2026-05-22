const { getSavedReport, getRefreshStatus } = require("./refresh-prices");

exports.handler = async () => {
  try {
    const [report, status] = await Promise.all([
      getSavedReport().catch(() => null),
      getRefreshStatus().catch(() => null)
    ]);

    return json({
      report,
      status: status || { status: report ? "ready" : "empty" }
    });
  } catch (error) {
    return json({ error: error.message || "Erro ao carregar relatório salvo" }, 500);
  }
};

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

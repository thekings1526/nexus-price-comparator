const { buildReport, saveReport, setRefreshStatus } = require("./refresh-prices");

exports.handler = async (event) => {
  const startedAt = new Date().toISOString();
  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  try {
    await setRefreshStatus({
      status: "running",
      startedAt,
      message: "Atualização completa em andamento"
    });

    const report = await buildReport({
      competitors: body.competitors,
      limit: "all"
    });
    await saveReport(report);
  } catch (error) {
    await setRefreshStatus({
      status: "error",
      startedAt,
      failedAt: new Date().toISOString(),
      message: error.message || "Erro na atualização completa"
    }).catch(() => null);
    throw error;
  }
};

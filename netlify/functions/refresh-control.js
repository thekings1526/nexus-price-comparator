exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json({ error: "Metodo nao permitido" }, 405);
  }

  try {
    const body = parseBody(event);
    const action = body.action === "stop" ? "stop" : "";
    if (!action) return json({ error: "Acao de controle invalida" }, 400);

    const {
      getRefreshStatus,
      setRefreshControl,
      setRefreshStatus
    } = require("./refresh-prices");

    const requestedAt = new Date().toISOString();
    const control = await setRefreshControl({ action, requestedAt });
    const current = await getRefreshStatus().catch(() => null);
    await setRefreshStatus({
      ...(current || {}),
      status: "stopping",
      requestedAt,
      message: "Parada solicitada. A coleta vai salvar o item atual e pausar."
    });

    return json({ ok: true, control });
  } catch (error) {
    return json({ error: error.message || "Erro ao controlar a coleta" }, 500);
  }
};

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
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

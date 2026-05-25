const { getReviewOverrides, recordReviewDecision } = require("./refresh-prices");

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "GET") {
      return json({ overrides: await getReviewOverrides().catch(() => null) });
    }
    if (event.httpMethod !== "POST") return json({ error: "Metodo nao permitido" }, 405);

    const body = event.body ? JSON.parse(event.body) : {};
    const overrides = await recordReviewDecision(body);
    return json({ ok: true, overrides });
  } catch (error) {
    return json({ error: error.message || "Erro ao salvar revisão" }, 500);
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

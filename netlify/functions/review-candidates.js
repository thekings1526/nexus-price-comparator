const { getReviewCandidates } = require("./refresh-prices");

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const payload = await getReviewCandidates({
      ownUrl: params.ownUrl,
      competitorId: params.competitorId,
      limit: params.limit || 10
    });
    return json(payload);
  } catch (error) {
    return json({ error: error.message || "Erro ao carregar candidatos" }, 500);
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

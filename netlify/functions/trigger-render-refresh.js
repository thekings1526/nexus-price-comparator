exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json({ error: "Metodo nao permitido" }, 405);
  }

  const apiKey = process.env.RENDER_API_KEY;
  const cronJobId = process.env.RENDER_CRON_JOB_ID;
  if (!apiKey || !cronJobId) {
    return json({ error: "Trigger do Render nao configurado" }, 500);
  }

  try {
    const response = await fetch(`https://api.render.com/v1/cron-jobs/${cronJobId}/runs`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`
      }
    });
    const payload = await safeJson(response);
    if (!response.ok) {
      return json({
        error: payload?.message || "Não consegui iniciar a coleta no Render",
        details: payload
      }, response.status);
    }
    return json({
      ok: true,
      message: "Coleta iniciada no Render",
      render: payload
    });
  } catch (error) {
    return json({ error: error.message || "Erro ao acionar o Render" }, 500);
  }
};

async function safeJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
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

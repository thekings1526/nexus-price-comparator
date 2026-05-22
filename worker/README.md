# Worker de precos

Este worker faz a parte pesada do comparador: varre o catalogo da Nexus, indexa os sitemaps de produtos dos concorrentes, compara os candidatos mais provaveis, separa primaria/secundaria e salva o relatorio no Netlify Blobs.

## Recomendacao

Use o painel na Netlify e rode este worker como Cron Job no Render.

Config:

- Build command: `npm install`
- Start command: `npm run worker:refresh`
- Schedule: `0 8 1 1 *`
- Environment variables:
  - `NEXUS_BLOBS_SITE_ID`
  - `NEXUS_BLOBS_TOKEN`
  - `WORKER_BATCH_SIZE=1`
  - `WORKER_REQUEST_DELAY_MS=150`
  - `WORKER_ITEM_RETRIES=1`
  - `WORKER_SAVE_EVERY=5`
  - `CATALOG_CANDIDATE_LIMIT=5`
  - `WORKER_RESUME=1` somente se quiser retomar relatorio parcial antigo

O horario do cron no Render e UTC. Essa agenda deixa o cron praticamente parado; o uso normal e disparar a coleta manualmente pelo painel.

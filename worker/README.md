# Worker de precos

Este worker faz a parte pesada do comparador: varre o catalogo da Nexus, consulta concorrentes, separa primaria/secundaria e salva o relatorio no Netlify Blobs.

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
  - `WORKER_REQUEST_DELAY_MS=1200`
  - `WORKER_ITEM_RETRIES=1`

O horario do cron no Render e UTC. Essa agenda deixa o cron praticamente parado; o uso normal e disparar a coleta manualmente pelo painel.

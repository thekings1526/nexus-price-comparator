# Worker de precos

Este worker faz a parte pesada do comparador: varre o catalogo da Nexus, consulta concorrentes, separa primaria/secundaria e salva o relatorio no Netlify Blobs.

## Recomendacao

Use o painel na Netlify e rode este worker como Cron Job no Render.

Config:

- Build command: `npm install`
- Start command: `npm run worker:refresh`
- Schedule: `0 8 * * *`
- Environment variables:
  - `NEXUS_BLOBS_SITE_ID`
  - `NEXUS_BLOBS_TOKEN`
  - `WORKER_BATCH_SIZE=4`

O horario do cron no Render e UTC. `0 8 * * *` roda uma vez por dia as 05:00 no horario de Brasilia.

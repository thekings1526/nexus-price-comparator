# Coordenadas para ativar o worker

## Melhor caminho

Manter o painel na Netlify e criar apenas o worker no Render.

## O que eu ja deixei pronto

- `worker/daily-refresh.js`: script que roda a coleta completa.
- `render.yaml`: blueprint para Render criar o Cron Job.
- `.env.example`: modelo das variaveis.
- `.deploy/nexus-comparador-render-*.zip`: pacote limpo para subir no GitHub se precisar.

## Estado atual

O repositorio GitHub, o site Netlify e o Cron Job do Render ja foram criados.

- Painel: https://comparadordeprecosnexus.netlify.app
- Repositorio: https://github.com/thekings1526/nexus-price-comparator
- Cron Job Render: `nexus-price-worker`

## Configuracao do Cron Job

- Service type: Cron Job
- Name: `nexus-price-worker`
- Runtime: Node
- Build command: `npm install`
- Start command: `npm run worker:refresh`
- Schedule: `0 8 1 1 *`

O Render usa UTC. Essa agenda deixa o cron praticamente parado; o uso normal e disparar manualmente pelo painel.

## Variaveis no Render

- `NEXUS_BLOBS_SITE_ID`: `2a213dd3-1777-497e-b33c-979c47cd0924`
- `NEXUS_BLOBS_TOKEN`: token do Netlify
- `WORKER_BATCH_SIZE`: `1`
- `WORKER_REQUEST_DELAY_MS`: `1200`
- `WORKER_ITEM_RETRIES`: `1`

## Depois de criar

1. Clique em `Executar coleta` no painel ou `Trigger Run` no Cron Job do Render.
2. Abra o painel: https://comparadordeprecosnexus.netlify.app
3. Veja o status subir ate o total encontrado no catalogo.
4. Se falhar, investigar o produto indicado em vez de pular automaticamente.

## Plano B: GitHub Actions

Tambem existe workflow pronto em `.github/workflows/daily-refresh.yml`.

Observacao: para eu subir esse workflow pelo GitHub API, o token do GitHub precisa ter tambem o escopo `workflow`.
O token atual criou/subiu o repositorio, mas o GitHub bloqueou a criacao do arquivo de workflow.

Para usar esse plano, cadastre estes secrets no GitHub:

- `NEXUS_BLOBS_SITE_ID`
- `NEXUS_BLOBS_TOKEN`

Link do repositorio:

https://github.com/thekings1526/nexus-price-comparator/settings/secrets/actions

Depois, rode manualmente em:

https://github.com/thekings1526/nexus-price-comparator/actions/workflows/daily-refresh.yml

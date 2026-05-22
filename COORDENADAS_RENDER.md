# Coordenadas para ativar o worker

## Melhor caminho

Manter o painel na Netlify e criar apenas o worker no Render.

## O que eu ja deixei pronto

- `worker/daily-refresh.js`: script que roda a coleta completa.
- `render.yaml`: blueprint para Render criar o Cron Job.
- `.env.example`: modelo das variaveis.
- `.deploy/nexus-comparador-render-*.zip`: pacote limpo para subir no GitHub se precisar.

## O que falta para eu fazer por voce

Para eu criar o Render Cron Job diretamente, preciso de uma destas opcoes:

### Opcao A: voce cria o repositorio e me passa o link

1. Criar um repositorio no GitHub.
2. Subir o conteudo deste projeto.
3. Me passar o link do repositorio.
4. No Render, conectar esse repositorio.

Depois disso eu te guio nos campos ou configuro se voce me der acesso.

### Opcao B: voce me passa acessos temporarios

Preciso de:

- Link/conta do Render com permissao para criar Cron Job.
- Um token/API key do Render, se quiser que eu tente pela API.
- Um repositorio GitHub onde o Render consiga ler o codigo.

Nao cole senha pessoal se nao quiser. O ideal e usar token temporario/revogavel.

## Configuracao do Cron Job

- Service type: Cron Job
- Name: `nexus-price-worker`
- Runtime: Node
- Build command: `npm install`
- Start command: `npm run worker:refresh`
- Schedule: `0 8 * * *`

O Render usa UTC. Esse horario roda por volta de 05:00 no horario de Brasilia.

## Variaveis no Render

- `NEXUS_BLOBS_SITE_ID`: `2a213dd3-1777-497e-b33c-979c47cd0924`
- `NEXUS_BLOBS_TOKEN`: token do Netlify
- `WORKER_BATCH_SIZE`: `4`

## Depois de criar

1. Clique em `Trigger Run` no Cron Job do Render.
2. Abra o painel: https://comparadordeprecosnexus.netlify.app
3. Veja o status subir ate `1039 de 1039`.
4. Se passar de tempo ou falhar, reduzimos `WORKER_BATCH_SIZE` para `2`.

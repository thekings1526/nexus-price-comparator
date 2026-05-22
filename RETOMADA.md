# Retomada do projeto

Este arquivo existe para nao perdermos o contexto do comparador.

## Objetivo

Criar um comparador de precos para a Nexus Games Digital, comparando cada jogo com concorrentes escolhidos, separando licenca primaria e secundaria.

## Decisao atual

Nao vamos levar o site todo para outro lugar. A arquitetura escolhida e hibrida:

- Netlify fica com o painel visual leve.
- Um worker externo roda a coleta pesada uma vez por dia.
- O worker salva o resultado no Netlify Blobs.
- O painel da Netlify apenas le o relatorio salvo.

## Por que separar

O catalogo encontrado tem cerca de 1039 itens. Para cada item, a coleta pode consultar 4 concorrentes e validar paginas de produto. Isso e pesado demais para depender de uma aba aberta ou de uma funcao curta na Netlify.

## Estado atual

- Painel publicado: https://comparadordeprecosnexus.netlify.app
- Netlify site ID: `2a213dd3-1777-497e-b33c-979c47cd0924`
- A tela ja foi repaginada para ficar mais limpa.
- O botao manual de atualizar foi removido da tela.
- O painel mostra status da coleta e progresso.
- O status salvo atual pode aparecer como coleta parcial ate o worker externo rodar completo.
- Repositorio GitHub criado: https://github.com/thekings1526/nexus-price-comparator
- Tentativa de criar Cron Job no Render via API falhou porque a conta precisa cadastrar pagamento primeiro.

## Arquivos principais

- `index.html`: estrutura da tela.
- `styles.css`: visual do painel.
- `app.js`: filtros, ordenacao, renderizacao e leitura do relatorio salvo.
- `netlify/functions/refresh-prices.js`: parser e regras de busca/preco.
- `netlify/functions/price-report.js`: API usada pelo painel para ler relatorio/status.
- `worker/daily-refresh.js`: coleta pesada para rodar fora da Netlify.
- `render.yaml`: configuracao sugerida para Render Cron Job.
- `worker/README.md`: passo a passo do worker.
- `COORDENADAS_RENDER.md`: guia direto do que falta configurar no Render.
- `.github/workflows/daily-refresh.yml`: plano B usando GitHub Actions.

## Variaveis necessarias no Render

Nao salvar token real no repositorio.

- `NEXUS_BLOBS_SITE_ID`
- `NEXUS_BLOBS_TOKEN`
- `WORKER_BATCH_SIZE=4`

## Render Cron Job sugerido

- Build command: `npm install`
- Start command: `npm run worker:refresh`
- Schedule: `0 8 * * *`

O Render usa UTC. Esse horario roda por volta de 05:00 no horario de Brasilia.

## Proximos passos

1. Subir este projeto para um repositorio GitHub.
2. Cadastrar pagamento no Render em https://dashboard.render.com/billing.
3. Criar um Cron Job no Render conectado ao repositorio.
4. Configurar as variaveis acima no Render.
5. Rodar o Cron Job manualmente uma primeira vez pelo painel do Render.
6. Conferir no painel da Netlify se o status chega em `1039 de 1039`.
7. Revisar os produtos que ficarem sem preco confiavel e ajustar regras caso necessario.

## Observacoes importantes

- A coleta ignora aluguel.
- A coleta tenta evitar troca entre primaria e secundaria usando IDs de variacao quando o site informa esses IDs.
- Se um concorrente muda HTML ou nome de produto, alguns itens podem ficar sem preco confiavel ate ajustarmos as regras.
- O painel nao deve fazer coleta pesada no navegador.
- Existe um pacote limpo em `.deploy/nexus-comparador-render-*.zip` para facilitar subir o projeto sem `node_modules` e sem arquivos locais pesados.

# Comparador de precos Nexus

Painel separado para acompanhar precos da Nexus Games Digital contra concorrentes selecionados.

## Arquitetura atual

- Netlify: hospeda somente o painel leve e as funcoes de leitura/salvamento.
- Worker externo: roda a coleta pesada diariamente e grava o relatorio no Netlify Blobs.
- Render Cron Job: recomendacao atual para hospedar o worker, porque a coleta pode demorar bastante.

## Publicado

- Painel: https://comparadordeprecosnexus.netlify.app
- Netlify site ID: `2a213dd3-1777-497e-b33c-979c47cd0924`

## Concorrentes monitorados

- Mex Games
- Rafa Gamer
- NGCP Games
- Coelho Gamer

## O que o painel faz

- Diferencia licenca primaria e licenca secundaria.
- Ignora variacoes de aluguel.
- Mostra Nexus mais caro, mesmo preco/proximo, Nexus mais barato e sem preco confiavel.
- Permite buscar por jogo/plataforma.
- Permite filtrar por comparacao e licenca.
- Permite ordenar por prioridade, diferenca e preco.
- Mostra status da coleta: itens processados, total e progresso.

## O que fica fora da Netlify

A busca completa pelos produtos e concorrentes deve rodar no worker em `worker/daily-refresh.js`.
Isso evita deixar a aba aberta e evita estourar os limites normais da Netlify.

## Para continuar depois

Leia primeiro `RETOMADA.md`.

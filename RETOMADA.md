# Retomada do projeto

Este arquivo existe para nao perdermos o contexto do comparador.

## Objetivo

Criar um comparador de precos para a Nexus Games Digital, comparando cada jogo com concorrentes escolhidos, separando licenca primaria e secundaria.

## Decisao atual

Nao vamos levar o site todo para outro lugar. A arquitetura escolhida e hibrida:

- Netlify fica com o painel visual leve.
- Um worker externo roda a coleta pesada sob demanda.
- O worker salva o resultado no Netlify Blobs.
- O painel da Netlify apenas le o relatorio salvo.

## Por que separar

O catalogo encontrado tem cerca de 1039 itens. A coleta pesada nao deve depender de uma aba aberta ou de uma funcao curta na Netlify.

## Estado atual

- Painel publicado: https://comparadordeprecosnexus.netlify.app
- Netlify site ID: `2a213dd3-1777-497e-b33c-979c47cd0924`
- A tela ja foi repaginada para ficar mais limpa.
- O botao manual de atualizar foi removido da tela.
- O painel mostra status da coleta e progresso.
- O status salvo atual pode aparecer como coleta parcial ate o worker externo rodar completo.
- Repositorio GitHub criado: https://github.com/thekings1526/nexus-price-comparator
- Cron Job Render criado: `nexus-price-worker`
- Render cron ID: `crn-d87t66n7f7vs73dqjnpg`
- Agenda configurada como `0 8 1 1 *` para nao rodar todo dia sozinho. O uso normal sera manual pelo painel.
- Em 22/05/2026, a coleta falhou com `HTTP 403` em produto da Nexus. Produto abria normal fora do worker, entao a causa provavel e bloqueio por ritmo/volume de requisicoes.
- Ajuste feito: worker indexa primeiro os sitemaps de produtos dos concorrentes, compara em memoria e so abre as paginas candidatas mais provaveis.
- Config atual sugerida: `WORKER_REQUEST_DELAY_MS=150`, `WORKER_SAVE_EVERY=5`, `CATALOG_CANDIDATE_LIMIT=5` e `WORKER_ITEM_RETRIES=1`.
- Regra atual: nao pular produto. Se um produto travar, a coleta para e mostra o item para investigarmos a raiz.
- A base foi reiniciada depois de suspender/retomar o Render; coleta limpa recomecou do item 1.
- Regra de comparacao atual: o nome do jogo e a plataforma continuam sendo os sinais mais fortes. Imagem, descricao e edicao entram como reforco de confianca, mas nao sao exigidas como match perfeito para nao perder produtos validos.
- A regra de numeros obrigatorios usa apenas numeros do titulo do produto, evitando que numeros comuns da descricao bloqueiem comparacoes boas.
- Numeros de sequencia no titulo do concorrente agora tambem sao tratados com mais cuidado. Se a Nexus tem `Modern Warfare` sem numero, o concorrente `Modern Warfare 3` nao deve ser aceito como o mesmo jogo.
- O worker agora comeca uma coleta completa limpa por padrao, sem reaproveitar itens antigos. Para retomar parcial seria preciso ligar `WORKER_RESUME=1`, mas isso nao e recomendado enquanto estamos refinando as regras.
- A busca agora avalia mais candidatos por concorrente e trata numeros romanos como equivalentes aos numeros normais no titulo, por exemplo `II` e `2`.
- Quando a busca do concorrente devolve link sem texto visivel, a primeira triagem usa tambem o endereco do produto como nome provisorio. A validacao final ainda abre a pagina e confere o titulo real.
- A pontuacao da triagem inicial agora e mais leve do que a validacao final. Isso evita perder produtos quando a busca do concorrente retorna so o link, mas a pagina aberta ainda precisa passar pela regra completa.
- A escolha do concorrente agora avalia todos os candidatos abertos e escolhe o melhor pela pontuacao final, em vez de aceitar o primeiro candidato valido. Isso ajuda a evitar trocar versao normal por `Ultimate`, `Deluxe` etc.
- Jogos com titulo curto, como `FC 26`, `Minecraft` e `PES 2020`, usam uma pontuacao minima final menor quando o titulo bate bem, porque muitas paginas de concorrente nao trazem descricao suficiente.
- A comparacao de edicao agora olha o titulo, nao a descricao. Isso evita ler termos como `Ultimate Team` da descricao do FC como se o produto fosse `Ultimate Edition`.
- Anos abreviados e completos agora sao equivalentes em titulos de temporada, por exemplo `FIFA 23` com `FIFA 2023` e `PES 2020` com `PES 20`.
- Essa equivalencia de ano tambem vale na triagem inicial dos links de busca, nao apenas na validacao final da pagina.
- A coleta nova nao faz mais busca nos concorrentes para cada jogo por padrao. Ela usa os sitemaps `sitemap/product-*.xml` como indice de URLs, ranqueia candidatos pelo nome/URL e valida abrindo a pagina final.
- Franquias com subtitulo sensivel, como `Call of Duty`, exigem que o subtitulo principal bata. Isso evita comparar `Modern Warfare` com `Infinite Warfare`.
- Edicoes fortes no titulo do concorrente, como `Remastered`, `Ultimate`, `Deluxe` e `Gold`, bloqueiam o match quando a Nexus nao traz essa edicao no titulo.
- Se o indice por sitemap nao achar um concorrente com seguranca, o worker usa a busca antiga como fallback apenas para aquele concorrente/produto.
- `PS3` agora e tratado como plataforma diferente para evitar que um produto PS4 caia em uma pagina PS3.
- Em 22/05/2026 foi adicionada a revisao manual no painel: cada card de concorrente tem botoes `Correto`, `Errado`, `Trocar` e `Nao tem hoje`.
- As correcoes manuais ficam salvas no Netlify Blobs em `match-overrides` e sao lidas pelo worker nas proximas coletas.
- O modal `Trocar` mostra os dados do produto da Nexus e candidatos do concorrente dentro do proprio painel, com imagem, precos e leitura da IA observadora.
- A IA observadora agora mostra confianca e motivos do match, mas nao decide sozinha acima das marcacoes manuais.
- Foi corrigido um falso positivo importante: numero e edicao nao bastam mais para aceitar match. Precisa bater tambem pelo menos uma palavra forte do nome do jogo, evitando casos como `Remnant II 2 Ultimate` cair em `Dead Island 2 Ultimate`.
- A alteracao foi publicada no GitHub no commit `03ef653` e no Netlify no deploy `6a105f13ed7186b050269e41`.
- Uma nova coleta foi disparada no Render em 22/05/2026 para recalcular o relatorio com essas regras.
- Em 23/05/2026 a revisao manual foi simplificada: fora do modal aparecem apenas `Este e o correto` e `Procurar outro`. Quando um par e confirmado manualmente, os botoes somem daquele concorrente.
- O modal de correcao agora tem busca interna no concorrente. O usuario pode digitar o nome usado pelo concorrente, ver candidatos com preco/imagem e escolher o produto correto sem sair do painel.
- A opcao `Nao tem no concorrente hoje` marca ausencia temporaria; isso nao bloqueia o robo para sempre, pois o concorrente pode cadastrar o produto em outra coleta.
- A comparacao de versoes ficou mais rigida: edicoes/pacotes como `Deluxe`, `Ultimate`, `Anthology`, `Premium`, `Pack`, `Bundle`, `Collection`, `Trilogy`, `Gold`, `Complete`, `Definitive` e similares precisam bater entre Nexus e concorrente.
- A tela foi reorganizada com nomes mais diretos nos filtros, resumo e colunas: `Situacao`, `Preco alinhado`, `Sem referencia`, `Melhor concorrente`, `Variacao`, etc.
- Alteracoes publicadas no Netlify no deploy `6a11f88c0d4e8999b5605e82`. A nova coleta foi disparada no Render em 23/05/2026 para recalcular a base com as regras de versao/pacote.
- Ainda em 23/05/2026 foi feita uma remodelagem visual mais estrutural: painel de filtros com cabecalho, contador de resultados, cabecalho da lista, cards de concorrentes mais organizados, destaque lateral por situacao e leitura mais clara de Nexus / melhor concorrente / variacao.
- Remodelagem publicada no Netlify no deploy `6a11fb0e67b486ae1bfb32e0`.
- Depois da revisao visual, a lista deixou de parecer tabela e passou a usar cards de analise por produto/licenca: bloco do produto, faixa de precos e bloco de concorrentes. Deploy Netlify `6a11fd29749b3fae9a63493b`.
- A confirmacao manual no painel atualiza todas as licencas do mesmo produto/concorrente no estado local imediatamente. Como o override salvo e por produto + concorrente, o worker tambem aplica a confirmacao para primaria e secundaria nas proximas leituras.
- Em 23/05/2026 foi corrigido o comportamento de tempo real dos botoes de revisao: o painel agora guarda as decisoes locais em `nexus-review-decisions` e reaplica por cima do relatorio quando o auto-refresh carrega dados antigos. O botao `Usar este` tambem leva os dados do candidato escolhido para atualizar o card na hora.
- Em 23/05/2026 foi feita a limpeza visual das revisoes resolvidas: apos `Produto correto`, `Usar este` ou `Nao tem no concorrente hoje`, o bloco grande de botoes some. Confirmado/trocado fica sem botao; ausencia temporaria fica apenas com um botao pequeno `Revisar`.

## Arquivos principais

- `index.html`: estrutura da tela.
- `styles.css`: visual do painel.
- `app.js`: filtros, ordenacao, renderizacao e leitura do relatorio salvo.
- `netlify/functions/refresh-prices.js`: parser e regras de busca/preco.
- `netlify/functions/price-report.js`: API usada pelo painel para ler relatorio/status.
- `worker/daily-refresh.js`: coleta pesada para rodar fora da Netlify.
- `render.yaml`: configuracao sugerida para Render Cron Job manual/quase parado.
- `worker/README.md`: passo a passo do worker.
- `COORDENADAS_RENDER.md`: guia direto do que falta configurar no Render.
- `.github/workflows/daily-refresh.yml`: plano B usando GitHub Actions.

## Variaveis necessarias no Render

Nao salvar token real no repositorio.

- `NEXUS_BLOBS_SITE_ID`
- `NEXUS_BLOBS_TOKEN`
- `WORKER_BATCH_SIZE=1`
- `WORKER_REQUEST_DELAY_MS=150`
- `WORKER_ITEM_RETRIES=1`
- `WORKER_SAVE_EVERY=5`
- `CATALOG_CANDIDATE_LIMIT=5`

## Render Cron Job sugerido

- Build command: `npm install`
- Start command: `npm run worker:refresh`
- Schedule: `0 8 1 1 *`

O Render usa UTC. Essa agenda deixa o cron praticamente parado; o uso normal e disparar manualmente pelo painel.

## Proximos passos

1. Aguardar a coleta atual do Render finalizar.
2. Conferir no painel se o status chega no total encontrado do catalogo.
3. Usar `Correto`, `Errado`, `Trocar` e `Nao tem hoje` para ensinar os pares que ainda ficarem duvidosos.
4. Revisar os produtos que ficarem sem preco confiavel e ajustar regras caso necessario.

## Observacoes importantes

- A coleta ignora aluguel.
- A coleta tenta evitar troca entre primaria e secundaria usando IDs de variacao quando o site informa esses IDs.
- Se um concorrente muda HTML ou nome de produto, alguns itens podem ficar sem preco confiavel ate ajustarmos as regras.
- O painel nao deve fazer coleta pesada no navegador.
- Existe um pacote limpo em `.deploy/nexus-comparador-render-*.zip` para facilitar subir o projeto sem `node_modules` e sem arquivos locais pesados.

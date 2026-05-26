# Retomada do projeto

Este arquivo existe para nao perdermos o contexto do comparador.

Existe tambem o arquivo `CONTEXTO_COMPLETO.md`, criado para retomar o projeto em uma conversa nova sem depender do historico completo do chat. Em nova conversa, ler `RETOMADA.md` e `CONTEXTO_COMPLETO.md` antes de mexer no projeto.

## Regra permanente de continuidade

E imprescindivel registrar todo andamento relevante do projeto para proximos chats poderem consultar. Antes de encerrar qualquer conversa em que houver analise, decisao, ajuste, deploy, validacao, erro encontrado, pendencia ou mudanca de regra, atualizar `RETOMADA.md` e, quando mudar contexto geral/instrucao permanente, atualizar tambem `CONTEXTO_COMPLETO.md`.

O registro deve ser claro e datado quando possivel, incluindo:

- o que foi feito ou decidido;
- arquivos principais alterados;
- commits, deploys e servicos envolvidos;
- testes/validacoes realizados;
- problemas que ficaram pendentes;
- cuidados para nao repetir erros.

Se houver alteracao publicada ou decisao importante, tambem salvar no GitHub para que a continuidade nao dependa apenas do arquivo local.

Os tokens reais necessarios para Netlify, GitHub e Render foram salvos localmente em `.env.local`. Esse arquivo e ignorado pelo `.gitignore` e nao deve ser enviado ao GitHub, Netlify ou Render. Nao copiar os valores dos tokens para arquivos versionados.

## Objetivo

Criar um comparador de precos para a Nexus Games Digital, comparando cada jogo com concorrentes escolhidos, separando licenca primaria e secundaria.

## Registro de 26/05/2026 - aprendizado das correcoes manuais

Depois de novas correcoes manuais do usuario na Mex e na Nexus, foram transformados em regra geral apenas padroes seguros de matching, mantendo a prioridade maxima das marcacoes manuais. Arquivo alterado na Nexus: `netlify/functions/refresh-prices.js`.

Regras adicionadas/fortalecidas: normalizacao de typos (`digitall`, `digita`, `komba`, `mwii`, `mwiii`, `marvels`), separacao de slugs colados como `ps4midia`, remocao de carimbos de data/hora em slugs, equivalencias conservadoras para The Witcher 3/Wild Hunt, Call of Duty Modern Warfare 2019/II/III, PES/eFootball por ano, Little Nightmares 1+2, Rise of the Ronin/A Ascensao do Ronin, Resident Evil 7 Biohazard, Resident Evil Revelations 1+2 e Marvel Spider-Man base/GOTY. Tambem foi adicionada trava para impedir Spider-Man base/GOTY de aceitar Miles Morales ou Remastered.

Validacao local: `npm.cmd run check` passou; bateria simulada aceitou os casos positivos acima e rejeitou RE4 2005 vs Remake, Modern Warfare 2 vs III, Spider-Man vs Miles Morales e Elden Ring vs Nightreign. A mesma familia de ajustes foi aplicada separadamente no comparador Mex, sem misturar dados, deploys ou ids.

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
- Em 23/05/2026 foi corrigido o calculo do painel apos revisao manual: produto marcado como incorreto ou ausente hoje deixa de entrar no `Melhor concorrente`, na `Variacao`, no status e nas ordenacoes. A marcacao `incorreto` e especifica para o link rejeitado, entao outro link futuro do mesmo concorrente pode voltar a ser usado normalmente. O card passa a indicar `Ignorado no calculo` e o selo `Marcado incorreto` fica destacado.
- Publicacao validada no Netlify deploy `6a12059d1be7ddb8fdecb3cf`: painel abriu com 2076 cards, APIs `/api/report` e `/api/review-candidates` responderam JSON, sem erros de console, e a logica publicada foi testada com cenario simulado onde o concorrente incorreto sai da primaria e secundaria.
- Em 23/05/2026 foi iniciada a otimizacao da revisao manual: o painel agora abre o modal de troca imediatamente com os dados ja carregados da Nexus, faz pre-busca ao passar o mouse no botao `Trocar produto`, guarda candidatos ja consultados no navegador, salva confirmacoes de forma otimista e remove candidatos rejeitados sem recarregar a lista. No servidor, a busca de candidatos passou a reaproveitar o relatorio salvo para dados da Nexus, cachear catalogos dos concorrentes e cachear paginas de candidatos abertas recentemente. A busca interna do site do concorrente agora so roda quando o usuario digita uma pesquisa; a abertura inicial usa direto o catalogo cacheado.
- Ainda em 23/05/2026, a pesquisa digitada no modal foi otimizada: primeiro tenta resolver pelo catalogo cacheado do concorrente e so chama a busca externa do site se o catalogo retornar poucos candidatos.
- A leitura das paginas candidatas do modal tambem foi paralelizada com limite controlado, para trazer imagem/precos/licencas mais rapido sem transformar a correcao manual em uma coleta pesada.
- Validacao publicada no Netlify deploy `6a120c1d0d4e89c67b605d23`: modal de troca abriu em cerca de 0,4s no painel real, sem erros de console. API de candidatos no teste publicado: busca `fifa` em 515ms na primeira chamada e 407ms na repetida; busca `gta` em 530ms; abertura inicial repetida em 425ms.
- Em 23/05/2026 foi conferida a inconsistencia de producao `1038 itens salvos` contra `totalItems 1039`. A correcao de merge por URL em `worker/daily-refresh.js` estava correta, e foi reforcada a retomada parcial para usar URLs ainda nao processadas em vez de apenas `items.length`. Tambem foi confirmado que `refresh-prices.js` agora para com erro se um produto Nexus vier sem titulo legivel, em vez de pular silenciosamente.
- Essa correcao foi publicada na Netlify no deploy `6a1212cf572cfacd1f813b92` e as APIs continuaram respondendo. A base publicada ainda mostra `1038/1039` porque o relatorio salvo e antigo; para corrigir a contagem visivel precisa rodar uma nova coleta limpa no Render com o worker atualizado.
- Em 25/05/2026 foi otimizada a busca do painel para evitar travamentos ao pesquisar jogos: o frontend agora reaproveita o calculo dos cards, aplica pequeno atraso enquanto o usuario digita, normaliza busca com/sem acento e renderiza os cards em lotes. Publicado no GitHub no commit `622eeda` e na Netlify no deploy `6a13bf6c793798829ff553ef`. Validacao publicada: `/app.js` trouxe a logica nova, `/api/report` respondeu com 1038 itens, buscas `fifa` e `gta` responderam sem erros de console.
- Em 25/05/2026 foi adicionada a propagacao das acoes de revisao manual entre variacoes PS4 e PS5 do mesmo jogo. Quando o usuario confirma, troca, marca incorreto ou marca ausente em um concorrente, o painel aplica a mesma acao aos itens Nexus da mesma familia PS4/PS5, usando o link do concorrente ja existente em cada variacao para evitar confirmar URL de PS4 dentro de PS5. O salvamento em `match-overrides` tambem replica as decisoes por URL dos produtos irmaos, entao o worker aprende nas proximas coletas. Arquivos alterados: `app.js` e `netlify/functions/refresh-prices.js`. GitHub: `df01f01` e `cc4e45d`. Netlify: deploy `6a13c2bbc3866c88505cdebb`. Validacao publicada: `/app.js` contem a nova logica, `/api/report` respondeu com 1038 itens, `/api/review-decision` respondeu leitura de overrides e o painel abriu com 2076 resultados sem erros de console.
- Ainda em 25/05/2026 foi corrigido o caso especifico do botao `Trocar produto` / `Usar este`: ao escolher manualmente um produto do concorrente para PS4 ou PS5, a API agora tenta localizar automaticamente a variacao irma no mesmo concorrente trocando PS4/PS5 no nome e validando pelo motor de comparacao. A resposta da API devolve as decisoes aplicadas e o frontend usa isso para refletir tambem na tela, sem esperar nova coleta. Arquivos alterados: `app.js` e `netlify/functions/refresh-prices.js`. GitHub: `452f866` e `d9300fe`. Netlify: deploy `6a13c48a847e257f12621af3`. Validacao publicada sem gravar revisao real: `/app.js` contem `applyServerReviewDecisions`, `/api/report` respondeu com 1038 itens, `/api/review-decision` respondeu leitura de overrides e painel abriu com 2076 resultados sem erros de console.
- Ainda em 25/05/2026 foi adicionada uma camada de aprendizado para a IA observadora. Confirmacoes e trocas viram exemplos positivos; marcacoes como errado viram exemplos negativos. Esses exemplos ficam em `match-overrides.learning` e tambem sao sintetizados a partir das decisoes antigas ja salvas, usando o relatorio salvo como base. Nas coletas, itens ja confirmados manualmente continuam intocaveis; os demais podem ter a pontuacao ajustada pelos exemplos aprendidos, com bonus para padroes positivos e penalidade para padroes negativos. Arquivo alterado: `netlify/functions/refresh-prices.js`. GitHub: `b6125db` e `fa16177`. Netlify: deploys `6a13c79feaa35c7f72e3b5c6` e `6a13c85c25694a977c4bf24f`. Validacao publicada: `/api/review-decision` retornou `learning` com 55 exemplos, sendo 51 positivos e 4 negativos; `/api/report` respondeu com 1038 itens; painel abriu com 2076 resultados sem erros de console.
- Ainda em 25/05/2026 foi adicionado o titulo do produto usado em cada concorrente dentro dos cards, para reduzir a necessidade de abrir pagina por pagina. O painel mostra o titulo encurtado ate antes da plataforma PS4/PS5/PlayStation quando possivel; se o titulo nao vier no relatorio, usa o slug da URL como fallback. Arquivos alterados: `app.js` e `styles.css`. GitHub: `c43609a` e `d2eee5f`. Netlify: deploy `6a13c943c35e888480ef4d1f`. Validacao publicada: `/app.js` contem `competitorComparisonTitle`, `/styles.css` contem `.competitor-title`, painel abriu com 2076 resultados, 1164 titulos de concorrentes renderizados na primeira carga fatiada e sem erros de console.
- Ainda em 25/05/2026 foi corrigido o tratamento de produtos indisponiveis nos concorrentes. Caso-guia: `RoboCop: Rogue City - PS5` na Mex Games tem pagina ativa e preco antigo, mas mostra texto de indisponibilidade. O frontend agora ignora qualquer concorrente com `available === false` no calculo de melhor preco/variacao e mostra `Indisponivel - ignorado no calculo`. A coleta tambem passa a gravar `price: null` quando a variacao ou a pagina do concorrente esta indisponivel, detectando textos como `produto encontra-se indisponivel`, `avise/avisaremos quando chegar`, `sem estoque`, `esgotado` e `OutOfStock`. Arquivos alterados: `app.js` e `netlify/functions/refresh-prices.js`. GitHub: `078df9e` e `b090d3c`. Netlify: deploy `6a13d2ee9bd7dd6bc0a53d75`. Validacao publicada: `/app.js` contem a trava `value.available === false`; no relatorio publicado Robocop/Mex continua com preco antigo mas `available:false`, e a nova logica calcula `countableNow:false` para primaria e secundaria. A proxima coleta deve salvar esses precos como `null`.
- Ainda em 25/05/2026 foi feita uma auditoria geral das confirmacoes/aprendizado e dos produtos comparados. O Blob `match-overrides.learning` tinha 118 exemplos, sendo 114 positivos e 4 negativos. A auditoria separou falsos alertas legitimos de numerais/anos (`VII/7`, `II/2`, `FIFA 23/2023`) e encontrou falsos matches fortes no relatorio salvo: `Horizon Forbidden West PS4` na NGCP apontando para URL/titulo PS5, jogos `F1 22/F1 23` normais apontando para `F1 Manager`, e jogos base caindo em expansoes/pacotes como `Cyberpunk 2077` vs `Phantom Liberty`, `Elden Ring` vs `Shadow of the Erdtree Edition` e `Diablo IV` vs `Vessel/Lord of Hatred`. Foram adicionadas regras para o coletor bloquear `F1` normal contra `F1 Manager`, rejeitar candidato cujo titulo/URL explicita apenas a outra plataforma e bloquear divergencia de subtitulos de DLC/expansao conhecidos. O painel tambem ignora imediatamente esses pares automaticos no calculo, sem mexer em confirmacoes manuais. Simulacao no relatorio publicado indicou 18 linhas ignoradas pelas regras novas: 2 por plataforma, 4 por `F1 Manager` e 12 por DLC/expansao.
- Observacao importante em 25/05/2026: alguns concorrentes podem ter PS4 e PS5 na mesma pagina de produto, com variacoes/precos separados por plataforma. A regra de plataforma deve permitir paginas que mencionam PS4/PS5 juntas e bloquear apenas paginas exclusivamente da outra plataforma. O parser foi reforcado para guardar `platformLicenses` quando as variacoes estruturadas trazem a plataforma no nome, e o relatorio/modal passam a usar `licensesForPlatform(match, ownProduct.platform)` para pegar primaria/secundaria da plataforma certa quando existir.
- Em 25/05/2026 as 02:12 BRT, a coleta completa foi disparada manualmente pelo endpoint `/api/trigger-refresh`. Render retornou job `crn-d87t66n7f7vs73dqjnpg-1779685929` com status inicial `pending`. As checagens seguintes mostraram status `running`: primeiro `Lendo catalogo da Nexus`, depois `Comparando produtos. Catalogos: mex: 1267, rafa: 2895, ngcp: 1256, coelho: 1623`. A base limpa recomecou com `totalItems 1039`; a checagem mais recente antes de mudar de chat mostrou `160/1039` itens processados, atualizado em `2026-05-25T05:19:48.590Z`.
- Ainda em 25/05/2026 foi detectado que a coleta iniciada as 02:12 estava salvando concorrentes sem preco porque a regra nova de indisponibilidade lia mensagens genericas/escondidas de rodape/modal como se todos os produtos estivessem indisponiveis. A coleta ruim foi cancelada no Render via API (`DELETE /v1/cron-jobs/{cronJobId}/runs`, resposta 204). A regra foi corrigida para: nao marcar variacao estruturada como indisponivel apenas por texto no bloco HTML; limitar a leitura textual de indisponibilidade ao trecho inicial/relevante da pagina; manter suporte a `OutOfStock` estruturado. Commits: `26d828d` e ajuste final `17a9a2a`. Netlify deploy final: `6a13de0722605fbe422f30a0`. Render deploy final ficou `live` no commit `17a9a2a`.
- Depois da correcao de indisponibilidade, uma nova coleta limpa foi disparada: Render job `crn-d87t66n7f7vs73dqjnpg-1779687024`. Validacao ao vivo: endpoint de candidatos para `EA SPORTS FC 26 - PS4` voltou a retornar primaria `89.99` e secundaria `59.99` com `available:true`; primeiros lotes da nova coleta mostram precos de concorrentes voltando ao relatorio. Progresso observado: `40/1039`, com `224` URLs de concorrentes e `218` precos lidos em `320` slots, apenas `4` indisponiveis.
- Em 25/05/2026 foi feita uma revisao/teste completo no site publicado apos as mudancas do chat. O painel abriu no navegador interno publicado, com cards, precos, concorrentes, botao `Produto correto` e `Trocar produto`. A busca por `gta` funcionou e reduziu a lista para 4 resultados; filtros e ordenacao responderam; o modal `Trocar produto` abriu com candidato, precos, leitura da IA, `Usar este` e `Nao e este`. A API de `review-decision` continuou retornando 118 exemplos de aprendizado (114 positivos, 4 negativos). A API de candidatos validou `Horizon Forbidden West PS4` com candidato PS4 em score 25 e candidatos PS5 em score 0. A correcao de indisponibilidade tambem foi validada com `EA SPORTS FC 26 - PS4` retornando precos e `available:true`.
- Nessa revisao foi encontrado e corrigido mais um falso match: `The Dark Pictures Anthology: Season One` estava aceitando jogos individuais da franquia (`The Devil in Me`, `Little Hope`, `House of Ashes`). Foi adicionada regra de subtitulo para `Dark Pictures Anthology`, publicada no Netlify deploy `6a13e186f6c248a314680e77` e no Render commit `921569c`. Validacao ao vivo: para `Season One`, jogos individuais aparecem com score 0 e o candidato correto da Rafa fica com score 43. A coleta anterior foi cancelada e uma coleta limpa final foi disparada no Render job `crn-d87t66n7f7vs73dqjnpg-1779687908`; os primeiros 10 itens da nova coleta final tinham 62 precos lidos em 80 slots e 2 indisponiveis.
- Em 25/05/2026 foi reforcada a camada de aprendizado com comparacao cruzada entre concorrentes para o mesmo jogo/familia. Antes os exemplos positivos e negativos pesavam principalmente dentro do mesmo concorrente; agora confirmacoes em um concorrente tambem ajudam a avaliar candidatos parecidos em outros, com peso menor, e marcacoes incorretas em outro concorrente penalizam padroes semelhantes. Quando existe pelo menos um correto e um incorreto para a mesma familia, o coletor tambem compara os contrastes: familias candidatas confirmadas ganham pequeno bonus, familias rejeitadas perdem ponto, e tokens extras/missing que aparecem nos rejeitados mas nao nos confirmados viram sinal negativo. Validacao local simulada com `Cyberpunk 2077` correto contra `Cyberpunk 2077 Phantom Liberty`: candidato correto recebeu ajuste positivo `+9`; candidato parecido com o incorreto recebeu `-23`.
- Ainda em 25/05/2026 foi revisado o historico e os arquivos para fixar o fluxo de publicacao. Conclusao: GitHub e salvo via API porque `git` nao esta instalado; Netlify deve receber sempre estaticos + todas as funcoes em zips, nunca so os arquivos do painel; Render usa o repo GitHub e roda o Cron Job `nexus-price-worker`, disparado normalmente pelo painel/API. As chaves existem localmente em `.env.local` e nao devem ser copiadas para arquivos versionados. O playbook detalhado foi registrado em `CONTEXTO_COMPLETO.md`.
- Ainda em 25/05/2026 os ajustes de comparacao cruzada foram publicados. GitHub: `7af62fc` para `netlify/functions/refresh-prices.js`, `162622f` para `RETOMADA.md`, `ddcd2df` para `CONTEXTO_COMPLETO.md` e `47a9e52` para registrar a publicacao. Netlify: deploy `6a1452a31fc19b3184e2d70e`, publicado com estaticos + funcoes usando SHA1 para arquivos e SHA256 + `runtime=js` para funcoes. Render: Cron Job `nexus-price-worker` com auto deploy `yes`, deploy `dep-d8a56rrtqb8s73d659i0` live no commit `47a9e52`. Validacao publicada: painel `200`, `/app.js` `200`, `/api/report` `200` com `1039/1039` e status `ready`, `/api/review-decision` `200` com `126` exemplos de aprendizado, `/api/review-candidates` respondeu `200`.
- Ainda em 25/05/2026 foi investigado o sintoma "concorrente tem o jogo, mas o painel mostra sem preco" em `PRAGMATA` e `Ghost of Yotei`. Havia dois problemas diferentes: (1) confirmacoes/trocas manuais gravavam aprendizado mas o relatorio salvo continuava antigo, entao o painel podia voltar a mostrar sem preco; (2) a triagem automatica rejeitava candidatos antes de abrir a pagina quando o titulo era curto ou vinha abreviado/errado no concorrente. `PRAGMATA` era afetado pelo token residual `dia` de `Mídia`/mojibake e pela pontuacao minima alta para titulo de uma palavra. `Ghost of Yotei` era afetado por slugs/titulos `ytei`, `yote` e `yte` nos concorrentes.
- Correcoes aplicadas nessa investigacao: `app.js` preserva o candidato local quando a API devolve uma decisao aplicada sem snapshot; `recordReviewDecision` em `netlify/functions/refresh-prices.js` atualiza o relatorio salvo quando uma revisao manual e gravada; `dia` entrou nas listas de tokens ignorados; a pontuacao minima de preview caiu para titulos curtos; `yotei/ytei/yote/yte` entram na mesma familia; e foi adicionada regra generica para aceitar abreviacoes por perda de uma ou duas vogais em tokens distintivos do titulo, mantendo travas de plataforma, numero e edicao. A regra e propositalmente controlada para ampliar para casos parecidos sem aceitar Deluxe/Ultimate/pacotes quando o Nexus e a versao base.
- Validacoes locais/publicadas: `npm run check` passou; `PRAGMATA` passou a encontrar Mex, Rafa, NGCP e Coelho; `Ghost of Yotei` passou a encontrar Mex, Rafa, NGCP e, com o link informado pelo usuario, Coelho (`https://www.coelhogamer.com.br/ghost-of-yte-ps5-psn-midia-digital`). O candidato `Ghost of Yotei Digital Deluxe Edition` da Rafa continua com score `0`, como esperado para nao misturar edicao base com Deluxe. O relatorio salvo foi atualizado para esses exemplos: `PRAGMATA` mostra precos em quatro concorrentes; `Ghost of Yotei` mostra Mex `219.90/119.90`, Rafa `229.99/119.99`, NGCP `219.90/129.90` e Coelho `258.99/199.99`.
- A varredura leve dos catalogos, sem abrir todas as paginas, encontrou `209` pares onde o relatorio ainda esta sem preco mas o catalogo do concorrente tem candidato forte. Isso confirma que a correcao deve ser tratada como regra geral, nao so caso a caso. Para aplicar na base inteira foi disparada uma coleta limpa no Render em `25/05/2026 11:52 BRT`, run `crn-d87t66n7f7vs73dqjnpg-1779720732`; no primeiro status publicado ela estava `running`, mensagem `Lendo catalogo da Nexus`.
- Publicacao dessa rodada: GitHub commits `3dba3e7` (`app.js`), `6ea3182` (`refresh-prices.js` para titulos curtos/Yotei) e `0a73302` (`refresh-prices.js` com abreviacao por vogais). Netlify deploy final `6a14616ab56130014f52d13b`, com estaticos + 7 funcoes. Render deploy `dep-d8a613t7vvec73cfcae0` ficou `live` no commit `0a73302`. Validacao publicada: `/api/review-candidates` para Ghost/Coelho retornou `Ghost of Yōte` com score `28` e precos `258.99/199.99`; `/api/report` retornou status `ready` antes do disparo da coleta e os dois exemplos ja atualizados.

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

# Contexto completo do comparador Nexus

Arquivo criado para permitir continuar o projeto em uma conversa nova sem depender do historico completo do chat.

## Regra permanente de memoria do projeto

Todo andamento relevante do projeto deve ser registrado para os proximos chats consultarem. Antes de encerrar qualquer trabalho, atualizar `RETOMADA.md`; se a mudanca afetar regras gerais, arquitetura, acessos, fluxo de publicacao ou instrucoes permanentes, atualizar tambem este `CONTEXTO_COMPLETO.md`.

Registrar de forma objetiva:

- o que foi feito/decidido;
- arquivos alterados;
- commits e deploys;
- validacoes feitas no painel publicado;
- pendencias, riscos e cuidados.

Quando houver commit/deploy ou decisao importante, salvar tambem no GitHub. Nao registrar tokens reais em arquivos versionados.

## Como retomar em uma nova conversa

Peça para o agente:

```text
Leia RETOMADA.md e CONTEXTO_COMPLETO.md e continue o comparador Nexus de onde paramos.
```

## Projeto

- Painel publicado: https://comparadordeprecosnexus.netlify.app
- Repositorio GitHub: https://github.com/thekings1526/nexus-price-comparator
- Pasta local: `C:\Users\wesle\Documents\Comparador de preço`
- Netlify site ID: `2a213dd3-1777-497e-b33c-979c47cd0924`
- Render cron ID: `crn-d87t66n7f7vs73dqjnpg`
- Render cron: `nexus-price-worker`

Os tokens reais ficam apenas no arquivo local `.env.local`, que e ignorado pelo Git. Nao registrar tokens reais neste arquivo nem em qualquer arquivo versionado.

## Objetivo do produto

Criar um comparador de precos para a Nexus Games Digital, comparando jogos com concorrentes especificos:

- Mex Games
- Rafa Gamer
- NGCP Games
- Coelho Gamer

O nicho trabalha com duas licencas por jogo:

- Primaria
- Secundaria

O comparador precisa separar os precos dessas duas licencas e mostrar claramente quando a Nexus esta:

- mais cara;
- com preco alinhado;
- mais barata;
- sem referencia confiavel.

Aluguel deve ser ignorado.

## Arquitetura escolhida

A arquitetura atual e hibrida:

- Netlify hospeda o painel visual e as APIs leves.
- Render Cron roda a coleta pesada.
- Netlify Blobs guarda relatorio, status de coleta e correcoes manuais.

Motivo: o catalogo da Nexus tem mais de 1000 produtos, entao a coleta nao deve depender de aba aberta no navegador nem de uma funcao curta da Netlify.

## Regras importantes combinadas com o usuario

- O painel nao deve fazer coleta pesada no navegador.
- O botao de coleta manual pode existir, mas deve avisar que pode gerar custo.
- A coleta deve procurar todos os produtos encontrados no site, sem limite fixo.
- Correcoes manuais devem ficar salvas para o robo aprender nas proximas coletas.
- Se marcar um concorrente como "nao tem hoje", isso nao deve bloquear para sempre, pois o nicho e volatil.
- Se marcar um produto como incorreto, a rejeicao deve ser especifica para aquele link, nao para o concorrente inteiro.
- Ao marcar primario como correto, secundario do mesmo produto/concorrente tambem deve ser considerado resolvido, e vice-versa.
- Acoes de revisao manual em um jogo PS4/PS5 devem refletir tambem na variacao irma PS4/PS5 do mesmo jogo. Em `Trocar produto` / `Usar este`, se o usuario encontrou o produto de uma plataforma no concorrente, a API deve tentar localizar a outra plataforma no mesmo concorrente trocando PS4/PS5 no nome e validando pelo motor de comparacao; se nao encontrar, usa o link do concorrente ja existente na variacao irma quando houver.
- A IA observadora tem uma camada de aprendizado em `match-overrides.learning`: confirmacoes e trocas viram exemplos positivos, marcacoes erradas viram exemplos negativos. A coleta usa esses exemplos para ajustar a pontuacao de produtos ainda nao confirmados manualmente. Produto ja confirmado como correto nao deve ser alterado pela IA.
- Produtos de concorrentes marcados como indisponiveis (`available === false`) nao devem entrar no calculo de melhor preco/variacao, mesmo que a pagina esteja ativa e tenha preco antigo. A coleta deve salvar preco `null` quando detectar indisponibilidade por texto/HTML.
- Tudo que for importante deve ser salvo em `RETOMADA.md` ou neste arquivo antes de encerrar a conversa.
- Antes de confirmar qualquer alteracao como feita, deve validar no painel publicado.

## Estado atual do painel

O painel esta publicado e funcional em:

https://comparadordeprecosnexus.netlify.app

Estado validado em 23/05/2026:

- painel abre com cerca de 2076 cards, contando primaria e secundaria;
- relatorio publicado tinha cerca de 1038 produtos;
- APIs `/api/report` e `/api/review-candidates` respondem JSON;
- sem erros de console nos testes feitos;
- modal de troca abriu em cerca de 0,4s depois das otimizacoes;
- busca `fifa` e `gta` no modal ficou por volta de 0,5s em testes publicados.

## Fluxo de correcao manual

Fora do modal, cada card de concorrente pendente mostra:

- `Produto correto`
- `Trocar produto`

Quando o par e resolvido:

- confirmado/trocado: os botoes somem;
- marcado como ausente hoje ou incorreto: fica apenas um pequeno botao `Revisar`.

Ao clicar em `Trocar produto`:

- modal abre com dados da Nexus imediatamente;
- campo de busca aparece sem esperar internet;
- candidatos carregam por tras;
- usuario pode pesquisar pelo nome usado pelo concorrente;
- usuario pode escolher `Usar este`;
- usuario pode marcar `Nao tem no concorrente hoje`;
- usuario pode rejeitar um candidato com `Nao e este`, que remove o candidato sem recarregar tudo.

As decisoes manuais ficam no Netlify Blobs em `match-overrides`.

O frontend tambem guarda cache local em `localStorage`, chave:

```text
nexus-review-decisions
```

Isso permite atualizar a tela imediatamente mesmo antes da proxima coleta.

## Otimizacoes recentes

Foram feitas otimizacoes importantes na correcao manual:

- salvamento otimista: a tela responde antes de a Netlify terminar de gravar;
- modal abre imediatamente com dados ja carregados no relatorio;
- pre-busca ao passar o mouse no botao `Trocar produto`;
- cache de candidatos no navegador;
- cache em memoria nas funcoes Netlify para relatorio, catalogos de concorrentes e paginas candidatas;
- busca digitada tenta primeiro o catalogo cacheado;
- busca externa do site do concorrente so roda se o catalogo retornar poucos candidatos;
- leitura de paginas candidatas foi paralelizada com limite controlado.

Deploy validado dessa otimizacao:

```text
6a120c1d0d4e89c67b605d23
```

## Regras de matching

Principios:

- nome do jogo e plataforma sao sinais fortes;
- imagem, descricao e edicao reforcam confianca;
- nao exigir que todos os sinais batam, para nao perder produtos validos;
- bloquear comparacoes claramente erradas.

Casos ja tratados:

- PS3 deve ser plataforma diferente de PS4/PS5;
- numeros romanos equivalem a numeros normais quando cabivel;
- anos abreviados e completos podem ser equivalentes, por exemplo `FIFA 23` e `FIFA 2023`;
- franquias com subtitulo sensivel, como Call of Duty, exigem subtitulo mais compativel;
- edicoes fortes precisam bater quando aparecem no titulo, como Deluxe, Ultimate, Gold, Complete, Collection, Trilogy, Bundle, Anthology, Premium, Remaster, Remastered, Remake, Definitive, Pack.

Exemplo de falso positivo corrigido:

- `Remnant II 2 Ultimate` nao deve cair em `Dead Island 2 Ultimate`.

## Calculos do painel

Quando um produto do concorrente e marcado como incorreto ou ausente hoje:

- ele sai do `Melhor concorrente`;
- sai da `Variacao`;
- sai dos status/resumos;
- sai das ordenacoes;
- aparece como `Ignorado no calculo`.

Isso foi validado com simulacao e no site publicado.

## Arquivos principais

- `index.html`: estrutura da tela.
- `styles.css`: visual do painel.
- `app.js`: filtros, ordenacao, renderizacao, cache local e revisao manual.
- `netlify/functions/refresh-prices.js`: parser, matching, cache, relatorio e funcoes compartilhadas.
- `netlify/functions/price-report.js`: API do relatorio.
- `netlify/functions/review-candidates.js`: API de candidatos para correcao manual.
- `netlify/functions/review-decision.js`: API de gravacao das decisoes manuais.
- `worker/daily-refresh.js`: coleta pesada no Render.
- `RETOMADA.md`: memoria principal do projeto.
- `CONTEXTO_COMPLETO.md`: este arquivo.

## Cuidados ao trabalhar

- Git nao esta instalado localmente. Quando precisar salvar no GitHub, usar API do GitHub.
- Node pelo terminal PowerShell pode falhar com "Acesso negado"; usar o Node REPL MCP quando precisar validar sintaxe JS.
- Ao publicar na Netlify, incluir sempre os arquivos estaticos e as funcoes. Ja houve problema quando um deploy foi feito sem funcoes e as APIs sumiram.
- Sempre validar o painel publicado antes de dizer que esta pronto.
- Sempre atualizar `RETOMADA.md` ou este arquivo com decisoes importantes.
- A inconsistencia `items 1038` contra `totalItems 1039` foi atribuida provavelmente a merge antigo por `item.id`. O worker deve unir lotes por URL normalizada e, em retomada parcial, deve calcular os itens restantes pelas URLs ainda nao processadas. A correcao foi publicada na Netlify no deploy `6a1212cf572cfacd1f813b92`, mas a base visivel so muda apos nova coleta limpa no Render.
- Produto Nexus sem titulo legivel deve parar a coleta com erro mostrando o link, nao ser pulado silenciosamente.
- Em 25/05/2026 uma auditoria geral das comparacoes salvas encontrou 118 exemplos de aprendizado em `match-overrides.learning` (114 positivos e 4 negativos) e falsos matches fortes no relatorio atual: `Horizon Forbidden West PS4` apontando para produto PS5 da NGCP, `F1 22/F1 23` normais apontando para `F1 Manager`, e jogos base caindo em DLC/expansao/pacote como `Cyberpunk 2077` vs `Phantom Liberty`, `Elden Ring` vs `Shadow of the Erdtree Edition` e `Diablo IV` vs `Vessel/Lord of Hatred`. A regra de matching passou a bloquear `F1` normal contra `F1 Manager`, rejeitar candidato cujo titulo/URL explicita apenas a outra plataforma e bloquear divergencia de subtitulos de DLC/expansao conhecidos. O painel passou a ignorar imediatamente esses pares automaticos no calculo. Confirmacoes manuais continuam tendo prioridade sobre essas travas automaticas, exceto indisponibilidade, que segue fora do calculo.
- Ainda em 25/05/2026 foi registrada a regra de que alguns concorrentes podem usar uma unica pagina PS4/PS5 com variacoes/precos separados. A trava de plataforma deve permitir paginas com PS4 e PS5 juntas; o parser agora guarda `platformLicenses` quando as variacoes estruturadas indicam plataforma, e o relatorio/modal preferem os precos da plataforma do produto Nexus por meio de `licensesForPlatform`.
- Em 25/05/2026 as 02:12 BRT, a coleta completa foi disparada manualmente pelo endpoint publicado. Render job: `crn-d87t66n7f7vs73dqjnpg-1779685929`. Status confirmado como `running`, com catalogos carregados (`mex: 1267`, `rafa: 2895`, `ngcp: 1256`, `coelho: 1623`) e progresso mais recente observado em `160/1039`, atualizado em `2026-05-25T05:19:48.590Z`.
- Ainda em 25/05/2026 foi corrigida uma regressao da regra de indisponibilidade: a coleta estava marcando quase todos os concorrentes como `available:false` porque lia mensagens genericas de rodape/modal. A coleta ruim foi cancelada no Render. O parser agora limita indisponibilidade textual ao trecho inicial/relevante da pagina, nao derruba variacao estruturada so por texto no bloco, e conserva `OutOfStock` estruturado. Netlify final: `6a13de0722605fbe422f30a0`; Render final live no commit `17a9a2a`.
- Nova coleta limpa disparada apos a correcao: Render job `crn-d87t66n7f7vs73dqjnpg-1779687024`. Validacao ao vivo mostrou `EA SPORTS FC 26 - PS4` com precos de concorrente retornando e `available:true`. Progresso observado em `40/1039`; nos primeiros lotes havia `218` precos lidos em `320` slots.
- Revisao/teste completo no site publicado em 25/05/2026: painel abriu no navegador interno com cards, precos, concorrentes e botoes; busca por `gta` reduziu para 4 resultados; filtros/ordenacao responderam; modal `Trocar produto` abriu com candidato, precos, IA, `Usar este` e `Nao e este`. APIs validadas: `review-decision` manteve 118 exemplos de aprendizado; `review-candidates` validou `Horizon Forbidden West PS4` com PS4 em score 25 e PS5 em score 0; `EA SPORTS FC 26 - PS4` voltou com precos e `available:true`.
- Na mesma revisao foi corrigido o falso match `The Dark Pictures Anthology: Season One` contra jogos individuais da franquia. Regra adicionada em `franchiseSubtitleCompatible` com base `DARK_PICTURES_BASE_TOKENS`. Netlify final: `6a13e186f6c248a314680e77`; Render final live no commit `921569c`. Coleta final limpa disparada no Render job `crn-d87t66n7f7vs73dqjnpg-1779687908`; primeiros 10 itens tinham 62 precos em 80 slots.

## Fluxo de publicacao

O projeto usa tres destinos:

- GitHub: fonte de verdade do codigo, repositorio `thekings1526/nexus-price-comparator`.
- Netlify: painel publicado e funcoes leves.
- Render: Cron Job `nexus-price-worker` que roda `npm run worker:refresh`.

Tokens ficam somente em `.env.local`. As chaves locais existentes sao `NETLIFY_SITE_ID`, `NETLIFY_AUTH_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_TOKEN`, `RENDER_CRON_ID` e `RENDER_API_KEY`. Nunca gravar os valores reais em arquivos versionados.

Como o `git` nao esta instalado localmente, quando precisar salvar no GitHub use a API do GitHub com o token local. Atualize os arquivos alterados por API e registre o commit retornado. Se alterar `.github/workflows/*`, o token precisa ter escopo `workflow`; em tentativa anterior o GitHub bloqueou esse arquivo sem esse escopo.

Para publicar na Netlify via API, montar um deploy manual incluindo:

- arquivos estaticos do publish root: `index.html`, `styles.css`, `app.js`, `_redirects`, `netlify.toml` quando necessario;
- todas as funcoes atuais: `price-report`, `refresh-prices`, `refresh-batch`, `refresh-catalog-background`, `review-candidates`, `review-decision`, `trigger-render-refresh`;
- zips das funcoes com o `.js` da funcao na raiz do zip, arquivos compartilhados necessarios na raiz quando usados por `require("./refresh-prices")`, e `node_modules` dentro do zip para `@netlify/blobs`.

Ja houve problema quando um deploy subiu sem funcoes, entao nao publicar so os arquivos estaticos. Os artefatos antigos em `.netlify-upload/function-zips-*` mostram o formato correto dos zips. Depois do upload, esperar o deploy ficar publicado e anotar o ID.

Para Render, o deploy do codigo vem do GitHub. Depois que o GitHub estiver atualizado, conferir/aguardar o Render ficar `live` no commit novo quando a mudanca afetar o worker. A coleta pesada normalmente nao roda por agenda diaria: o schedule e `0 8 1 1 *` para quase parar automatico. O uso normal e disparar manualmente pelo painel (`/api/trigger-refresh`) ou pela API do Render criando run no cron `crn-d87t66n7f7vs73dqjnpg`.

Se uma mudanca afetar matching, parser, precos, indisponibilidade, aprendizado ou worker, o fluxo completo e:

1. Validar sintaxe local.
2. Salvar alteracoes no GitHub.
3. Publicar Netlify com estaticos e funcoes.
4. Confirmar Render no commit novo se a coleta depender da alteracao.
5. Disparar coleta limpa no Render quando for necessario recalcular a base.
6. Validar o painel publicado e APIs antes de dizer que esta pronto.

## Validacao obrigatoria antes de finalizar mudancas

Depois de mudancas relevantes:

- validar sintaxe JS;
- publicar Netlify com funcoes incluidas;
- abrir painel publicado;
- conferir que existem cards;
- conferir que `/api/report` responde JSON;
- conferir que `/api/review-candidates` responde JSON com parametros validos;
- conferir console sem erro;
- se mexer no fluxo manual, testar abrir modal e, quando possivel, medir tempos.

## O que fazer se uma nova conversa comecar

1. Ler `RETOMADA.md`.
2. Ler `CONTEXTO_COMPLETO.md`.
3. Confirmar o estado dos arquivos locais.
4. Validar o painel publicado se for fazer alteracao.
5. Continuar do ponto atual, sem recriar arquitetura.

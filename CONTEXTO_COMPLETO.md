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

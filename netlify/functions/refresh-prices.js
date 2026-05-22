const OWN_STORE = {
  id: "nexus",
  name: "Nexus Games",
  baseUrl: "https://www.nexusgamesdigital.com/",
  catalogUrls: [
    "https://www.nexusgamesdigital.com/playstation-4",
    "https://www.nexusgamesdigital.com/playstation-5"
  ]
};

const COMPETITORS = [
  { id: "mex", name: "Mex Games", baseUrl: "https://www.mexgames.com.br/" },
  { id: "rafa", name: "Rafa Gamer", baseUrl: "https://www.rafagamer.com.br/" },
  { id: "ngcp", name: "NGCP Games", baseUrl: "https://www.ngcpgames.com.br/" },
  { id: "coelho", name: "Coelho Gamer", baseUrl: "https://www.coelhogamer.com.br/" }
];

let lastFetchAt = 0;
let fetchQueue = Promise.resolve();

exports.handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const report = await buildReport(body);
    if (body.save) await saveReport(report);
    return json(report);
  } catch (error) {
    return json({ error: error.message || "Erro ao atualizar preços" }, 500);
  }
};

async function buildReport(options = {}) {
  const selectedIds = new Set(options.competitors || COMPETITORS.map((item) => item.id));
  const selectedCompetitors = COMPETITORS.filter((item) => selectedIds.has(item.id));
  const limit = normalizeLimit(options.limit);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const batchSize = options.batchSize ? clamp(Number(options.batchSize), 1, 20) : null;
  const competitorCatalogs = normalizeCompetitorCatalogs(options.competitorCatalogs);
  const parsedCompetitorCache = options.parsedCompetitorCache || new Map();
  const ownProductCache = options.ownProductCache || new Map();
  const reviewOverrides = options.reviewOverrides || await getReviewOverrides().catch(() => defaultReviewOverrides());
  const discoveredItems = Array.isArray(options.items) && options.items.length
    ? options.items.slice(0, limit)
    : await discoverOwnProducts(limit);
  const trackedItems = batchSize ? discoveredItems.slice(offset, offset + batchSize) : discoveredItems;

  const items = [];
  for (const tracked of trackedItems) {
    const ownProduct = await getOwnProduct(tracked, ownProductCache);
    if (!ownProduct || !ownProduct.title) continue;

    const licenses = {};
    for (const license of ["primary", "secondary"]) {
      licenses[license] = {
        myPrice: ownProduct.licenses?.[license]?.price ?? tracked.licenses?.[license]?.myPrice ?? null,
        competitors: {}
      };
    }

    const competitorMatches = await Promise.all(selectedCompetitors.map(async (competitor) => ({
      competitor,
      result: await findCompetitorProductForReport(competitor, ownProduct, competitorCatalogs.get(competitor.id), parsedCompetitorCache, reviewOverrides).catch(() => ({ match: null, source: "error" }))
    })));

    for (const { competitor, result } of competitorMatches) {
      const match = result?.match || null;
      const review = buildReviewInsight(ownProduct, competitor.id, match, result, reviewOverrides);
      if (!match) {
        for (const license of Object.keys(licenses)) {
          licenses[license].competitors[competitor.id] = { price: null, note: "Produto não encontrado com segurança" };
        }
        for (const license of Object.keys(licenses)) {
          licenses[license].competitors[competitor.id].review = review;
        }
        continue;
      }
      for (const license of Object.keys(licenses)) {
        const variant = match.licenses?.[license];
        licenses[license].competitors[competitor.id] = {
          price: variant?.price ?? null,
          url: match.url,
          title: match.title,
          available: variant?.available,
          review,
          note: variant?.price
            ? (variant.available === false ? "Variação indisponível no concorrente" : undefined)
            : match.note || "Licença não anunciada nessa página"
        };
      }
    }

    items.push({
      id: slugify(`${ownProduct.title}-${ownProduct.platform || ""}`),
      title: ownProduct.title,
      platform: ownProduct.platform,
      url: ownProduct.url,
      image: ownProduct.image,
      licenses
    });

    if (typeof options.onItem === "function") {
      await options.onItem({
        item: items[items.length - 1],
        items,
        index: items.length - 1,
        total: discoveredItems.length
      });
    }
  }

  return {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    source: "live",
    ownStore: OWN_STORE,
    competitors: selectedCompetitors,
    totalItems: discoveredItems.length,
    offset,
    batchSize: batchSize || discoveredItems.length,
    items
  };
}

async function getOwnProduct(tracked, cache) {
  if (!tracked?.url) return normalizeManualItem(tracked);
  if (cache.has(tracked.url)) return cache.get(tracked.url);
  const ownPage = await fetchProduct(tracked.url);
  const ownProduct = parseProductPage(ownPage.html, ownPage.url);
  cache.set(tracked.url, ownProduct);
  return ownProduct;
}

function normalizeCompetitorCatalogs(input) {
  const normalized = new Map();
  if (!input) return normalized;
  if (input instanceof Map) return input;
  for (const [id, items] of Object.entries(input)) {
    normalized.set(id, Array.isArray(items) ? items : []);
  }
  return normalized;
}

function normalizeLimit(limit) {
  if (limit === "all" || limit === 0 || limit === null) return Number.POSITIVE_INFINITY;
  const parsed = Number(limit);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 4;
}

async function getBlobStore() {
  const { getStore } = await import("@netlify/blobs");
  const siteID = process.env.NEXUS_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID;
  const token = process.env.NEXUS_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) {
    return getStore({ name: "nexus-price-comparator", siteID, token });
  }
  return getStore("nexus-price-comparator");
}

async function saveReport(report) {
  const store = await getBlobStore();
  await store.setJSON("latest-report", report, {
    metadata: { generatedAt: report.generatedAt, items: report.items.length }
  });
  await store.setJSON("refresh-status", {
    status: "ready",
    generatedAt: report.generatedAt,
    finishedAt: new Date().toISOString(),
    items: report.items.length
  });
}

async function saveReportWithStatus(report, status) {
  const store = await getBlobStore();
  await store.setJSON("latest-report", report, {
    metadata: { generatedAt: report.generatedAt, items: report.items.length }
  });
  await store.setJSON("refresh-status", {
    updatedAt: new Date().toISOString(),
    ...status
  });
}

async function getSavedReport() {
  const store = await getBlobStore();
  return store.get("latest-report", { type: "json", consistency: "strong" });
}

async function saveCatalogItems(items) {
  const store = await getBlobStore();
  await store.setJSON("catalog-items", {
    generatedAt: new Date().toISOString(),
    items
  }, {
    metadata: { items: items.length }
  });
}

async function getCatalogItems() {
  const store = await getBlobStore();
  const catalog = await store.get("catalog-items", { type: "json", consistency: "strong" });
  return Array.isArray(catalog?.items) ? catalog.items : [];
}

function defaultReviewOverrides() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    decisions: {}
  };
}

async function getReviewOverrides() {
  const store = await getBlobStore();
  return await store.get("match-overrides", { type: "json", consistency: "strong" }) || defaultReviewOverrides();
}

async function saveReviewOverrides(overrides) {
  const store = await getBlobStore();
  const payload = {
    ...defaultReviewOverrides(),
    ...overrides,
    updatedAt: new Date().toISOString()
  };
  await store.setJSON("match-overrides", payload, {
    metadata: { updatedAt: payload.updatedAt }
  });
  return payload;
}

async function recordReviewDecision(input) {
  const overrides = await getReviewOverrides().catch(() => defaultReviewOverrides());
  const ownUrl = input.ownUrl || input.productUrl;
  const competitorId = input.competitorId;
  if (!ownUrl || !competitorId) throw new Error("Produto e concorrente sao obrigatorios");

  const ownKey = reviewKey(ownUrl);
  const decisions = overrides.decisions || {};
  const current = decisions[ownKey]?.[competitorId] || {};
  const now = new Date().toISOString();
  const next = {
    ...current,
    ownUrl,
    competitorId,
    updatedAt: now,
    history: [
      ...(current.history || []).slice(-20),
      {
        action: input.action,
        competitorUrl: input.competitorUrl || "",
        note: input.note || "",
        createdAt: now
      }
    ]
  };

  if (input.action === "confirm" || input.action === "choose") {
    if (!input.competitorUrl) throw new Error("Link do concorrente e obrigatorio para confirmar");
    next.confirmedUrl = input.competitorUrl;
    next.confirmedAt = now;
    next.noTodayAt = "";
  }

  if (input.action === "wrong") {
    if (input.competitorUrl) {
      next.rejectedUrls = {
        ...(next.rejectedUrls || {}),
        [normalizeReviewUrl(input.competitorUrl)]: { rejectedAt: now, note: input.note || "" }
      };
      if (normalizeReviewUrl(next.confirmedUrl) === normalizeReviewUrl(input.competitorUrl)) next.confirmedUrl = "";
    }
  }

  if (input.action === "missing-today") {
    next.noTodayAt = now;
  }

  decisions[ownKey] = {
    ...(decisions[ownKey] || {}),
    [competitorId]: next
  };
  return saveReviewOverrides({ ...overrides, decisions });
}

function getReviewDecision(overrides, ownUrl, competitorId) {
  return overrides?.decisions?.[reviewKey(ownUrl)]?.[competitorId] || null;
}

function reviewPenalty(decision, competitorUrl) {
  if (!decision || !competitorUrl) return 0;
  return decision.rejectedUrls?.[normalizeReviewUrl(competitorUrl)] ? 80 : 0;
}

function reviewKey(value) {
  return normalizeReviewUrl(value);
}

function normalizeReviewUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim();
  }
}

async function setRefreshStatus(status) {
  const store = await getBlobStore();
  await store.setJSON("refresh-status", {
    updatedAt: new Date().toISOString(),
    ...status
  });
}

async function getRefreshStatus() {
  const store = await getBlobStore();
  return store.get("refresh-status", { type: "json", consistency: "strong" });
}

async function discoverOwnProducts(limit) {
  const found = new Map();
  for (const url of OWN_STORE.catalogUrls) {
    const visitedPages = new Set();
    let pageUrl = url;
    let emptyPages = 0;
    while (pageUrl && found.size < limit) {
      if (visitedPages.has(pageUrl)) break;
      visitedPages.add(pageUrl);
      let response;
      try {
        response = await fetchHtml(pageUrl);
      } catch {
        break;
      }
      const links = extractCatalogProductLinks(response.html, OWN_STORE.baseUrl);
      let added = 0;
      for (const link of links) {
        if (found.size >= limit) break;
        if (!found.has(link.url)) {
          found.set(link.url, link);
          added += 1;
        }
      }
      if (added === 0) emptyPages += 1;
      else emptyPages = 0;
      if (emptyPages >= 2) break;
      pageUrl = extractNextCatalogPageUrl(response.html, response.url || pageUrl);
    }
  }
  return Array.from(found.values()).slice(0, limit);
}

function withPage(url, page) {
  const next = new URL(url);
  next.searchParams.set("pagina", String(page));
  return next.toString();
}

function extractCatalogProductLinks(html, baseUrl) {
  const links = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let anchor;
  while ((anchor = anchorPattern.exec(html))) {
    const attrs = anchor[1];
    const className = getTagAttribute(attrs, "class") || "";
    if (!/\bnome-produto\b/i.test(className)) continue;
    const href = getTagAttribute(attrs, "href");
    const text = cleanText(anchor[2]);
    if (!href || href.includes("--") || text.includes("--PRODUTO")) continue;
    const url = toAbsoluteUrl(href, baseUrl);
    if (!url || !isLikelyProductUrl(url, baseUrl, text)) continue;
    links.push({ url, text });
  }
  return uniqueBy(links, (item) => item.url);
}

function extractNextCatalogPageUrl(html, currentUrl) {
  const relNext = match(html, /<link\b[^>]*rel=["']next["'][^>]*href=["']([^"']+)["']/i)
    || match(html, /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']next["']/i)
    || match(html, /<a\b[^>]*rel=["']next["'][^>]*href=["']([^"']+)["']/i)
    || match(html, /<a\b[^>]*href=["']([^"']+)["'][^>]*rel=["']next["']/i);
  const current = new URL(currentUrl);
  if (relNext && relNext !== "#") {
    const next = toAbsoluteUrl(relNext, currentUrl);
    if (next && isSameCatalogPage(next, currentUrl)) return next;
  }

  const currentPage = Number(current.searchParams.get("pagina") || 1);
  const nextPage = Array.from(html.matchAll(/[?&]pagina=(\d+)/g))
    .map((item) => Number(item[1]))
    .filter((page) => Number.isFinite(page) && page > currentPage)
    .sort((a, b) => a - b)[0];
  return nextPage ? withPage(currentUrl, nextPage) : "";
}

function isSameCatalogPage(candidateUrl, currentUrl) {
  const candidate = new URL(candidateUrl);
  const current = new URL(currentUrl);
  return candidate.hostname === current.hostname && candidate.pathname === current.pathname;
}

async function findCompetitorProduct(competitor, ownProduct) {
  const linksByUrl = new Map();
  for (const query of buildSearchQueries(ownProduct)) {
    const searchUrl = new URL("buscar", competitor.baseUrl);
    searchUrl.searchParams.set("q", query);
    try {
      const search = await fetchHtml(searchUrl.toString());
      for (const link of extractProductLinks(search.html, competitor.baseUrl)) {
        if (!linksByUrl.has(link.url)) linksByUrl.set(link.url, link);
      }
    } catch {
      // Try the next query variant.
    }
  }

  const links = Array.from(linksByUrl.values());
  const ranked = links
    .map((link) => ({ ...link, score: scoreCandidate(link, ownProduct, { preview: true }) }))
    .filter((link) => link.score >= 7)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const validated = [];
  for (const candidate of ranked) {
    try {
      const productPage = await fetchProduct(candidate.url);
      const product = parseProductPage(productPage.html, productPage.url);
      const score = scoreCandidate(product, ownProduct);
      if (score >= 16) {
        validated.push({ product, score });
      }
    } catch {
      // Keep trying the next candidate.
    }
  }
  return bestValidatedProduct(validated);
}

async function findCompetitorProductForReport(competitor, ownProduct, catalog, parsedCache, reviewOverrides = defaultReviewOverrides()) {
  const decision = getReviewDecision(reviewOverrides, ownProduct.url, competitor.id);
  if (decision?.confirmedUrl) {
    try {
      const manualProduct = await getParsedCompetitorProduct(decision.confirmedUrl, parsedCache);
      if (scoreCandidate(manualProduct, ownProduct) >= 8) {
        return { match: manualProduct, source: "manual-confirmed", decision };
      }
    } catch {
      // If the saved URL disappeared, fall through to automatic matching.
    }
  }

  if (Array.isArray(catalog) && catalog.length) {
    const indexedMatch = await findCompetitorProductFromCatalog(competitor, ownProduct, catalog, parsedCache, decision);
    if (indexedMatch?.match) return indexedMatch;
  }
  const fallback = await findCompetitorProduct(competitor, ownProduct);
  return { match: fallback, source: fallback ? "search-fallback" : "not-found", decision };
}

async function findCompetitorProductFromCatalog(competitor, ownProduct, catalog, parsedCache = new Map(), decision = null) {
  const ranked = catalog
    .map((link) => ({ ...link, score: scoreCandidate(link, ownProduct, { preview: true }) - reviewPenalty(decision, link.url) }))
    .filter((link) => link.score >= 7)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(process.env.CATALOG_CANDIDATE_LIMIT || 8));

  const validated = [];
  for (const candidate of ranked) {
    try {
      const product = await getParsedCompetitorProduct(candidate.url, parsedCache);
      const score = scoreCandidate(product, ownProduct) - reviewPenalty(decision, product.url);
      if (score >= 16) validated.push({ product, score });
    } catch {
      // Keep trying the next catalog candidate.
    }
  }
  return { match: bestValidatedProduct(validated), source: "catalog", decision, candidates: ranked };
}

function bestValidatedProduct(validated) {
  return validated
    .sort((a, b) => Number(hasAnyLicensePrice(b.product)) - Number(hasAnyLicensePrice(a.product)) || b.score - a.score)[0]
    ?.product || null;
}

function hasAnyLicensePrice(product) {
  return ["primary", "secondary"].some((license) => typeof product?.licenses?.[license]?.price === "number");
}

function buildReviewInsight(ownProduct, competitorId, match, result, overrides) {
  const decision = result?.decision || getReviewDecision(overrides, ownProduct.url, competitorId);
  if (decision?.confirmedUrl && match && normalizeReviewUrl(match.url) === normalizeReviewUrl(decision.confirmedUrl)) {
    return {
      status: "confirmed",
      confidence: 100,
      label: "Confirmado por voce",
      source: result?.source || "manual-confirmed",
      reasons: ["Vinculo salvo manualmente"]
    };
  }

  if (!match) {
    return {
      status: decision?.noTodayAt ? "missing-today" : "needs-review",
      confidence: decision?.noTodayAt ? 70 : 35,
      label: decision?.noTodayAt ? "Marcado sem produto hoje" : "Precisa revisar",
      source: result?.source || "not-found",
      reasons: [decision?.noTodayAt ? "Voce marcou que nao encontrou hoje" : "Nenhum candidato passou com seguranca"]
    };
  }

  const score = scoreCandidate(match, ownProduct);
  const reasons = [];
  const ownPlatform = normalize(ownProduct.platform || "");
  const candidateText = normalize(`${match.title || ""} ${match.description || ""} ${match.url || ""}`);
  const candidatePlatforms = platformsIn(candidateText);
  if (ownPlatform && candidatePlatforms.has(ownPlatform)) reasons.push("Plataforma bate");
  if (titleCoverageAccepted(gameTokens(ownProduct.title), new Set(gameTokens(match.title)))) reasons.push("Nome bate bem");
  if (hasAnyLicensePrice(match)) reasons.push("Preco de licenca lido");
  if (imageLooksRelated(ownProduct.image, match.image)) reasons.push("Imagem parece relacionada");
  if (decision?.rejectedUrls?.[normalizeReviewUrl(match.url)]) reasons.push("Voce ja marcou este par como errado");

  const confidence = clamp(Math.round(score * 3.2 + (hasAnyLicensePrice(match) ? 8 : 0)), 1, 96);
  const status = confidence >= 82 ? "auto-high" : confidence >= 58 ? "auto-medium" : "needs-review";
  return {
    status,
    confidence,
    label: status === "auto-high" ? "IA: alta confianca" : status === "auto-medium" ? "IA: conferir" : "IA: revisar",
    source: result?.source || "auto",
    reasons: reasons.length ? reasons.slice(0, 4) : ["Comparacao por nome e link"]
  };
}

async function getParsedCompetitorProduct(url, cache) {
  if (cache.has(url)) return cache.get(url);
  const productPage = await fetchProduct(url);
  const product = parseProductPage(productPage.html, productPage.url);
  cache.set(url, product);
  return product;
}

async function discoverCompetitorCatalogs(competitors = COMPETITORS) {
  const catalogs = new Map();
  for (const competitor of competitors) {
    catalogs.set(competitor.id, await discoverCompetitorCatalog(competitor));
  }
  return catalogs;
}

async function discoverCompetitorCatalog(competitor) {
  const sitemapUrls = await discoverProductSitemapUrls(competitor.baseUrl);
  const links = [];
  for (const sitemapUrl of sitemapUrls) {
    try {
      const response = await fetchHtml(sitemapUrl);
      for (const url of extractSitemapLocs(response.html)) {
        if (!isLikelyProductUrl(url, competitor.baseUrl, "")) continue;
        links.push(productLinkFromUrl(url));
      }
    } catch {
      // Keep the catalog usable even if one sitemap shard fails.
    }
  }
  return uniqueBy(links, (item) => item.url);
}

async function getReviewCandidates({ ownUrl, competitorId, limit = 10 }) {
  const competitor = COMPETITORS.find((item) => item.id === competitorId);
  if (!competitor) throw new Error("Concorrente invalido");
  if (!ownUrl) throw new Error("Produto Nexus obrigatorio");

  const [ownPage, overrides] = await Promise.all([
    fetchProduct(ownUrl),
    getReviewOverrides().catch(() => defaultReviewOverrides())
  ]);
  const ownProduct = parseProductPage(ownPage.html, ownPage.url);
  const decision = getReviewDecision(overrides, ownProduct.url, competitor.id);
  const catalog = await discoverCompetitorCatalog(competitor);

  const searchLinks = new Map();
  for (const query of buildSearchQueries(ownProduct)) {
    try {
      const searchUrl = new URL("buscar", competitor.baseUrl);
      searchUrl.searchParams.set("q", query);
      const search = await fetchHtml(searchUrl.toString());
      for (const link of extractProductLinks(search.html, competitor.baseUrl)) searchLinks.set(link.url, link);
    } catch {
      // Search is only an assist for the review modal.
    }
  }

  const ranked = uniqueBy([...catalog, ...searchLinks.values()], (item) => item.url)
    .map((link) => ({ ...link, score: scoreCandidate(link, ownProduct, { preview: true }) - reviewPenalty(decision, link.url) }))
    .filter((link) => link.score >= 4)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(Number(limit) || 10, 1));

  const candidates = [];
  for (const link of ranked) {
    try {
      const product = parseProductPage((await fetchProduct(link.url)).html, link.url);
      const score = scoreCandidate(product, ownProduct) - reviewPenalty(decision, product.url);
      candidates.push({
        url: product.url,
        title: product.title,
        image: product.image,
        platform: product.platform,
        licenses: product.licenses,
        score,
        review: buildReviewInsight(ownProduct, competitor.id, product, { source: "candidate", decision }, overrides)
      });
    } catch {
      // Keep other candidates available.
    }
  }

  return {
    ownProduct: {
      url: ownProduct.url,
      title: ownProduct.title,
      image: ownProduct.image,
      platform: ownProduct.platform,
      licenses: ownProduct.licenses
    },
    competitor,
    decision,
    candidates: candidates.sort((a, b) => b.score - a.score)
  };
}

async function discoverProductSitemapUrls(baseUrl) {
  const sitemapUrl = new URL("sitemap.xml", baseUrl).toString();
  const response = await fetchHtml(sitemapUrl);
  const urls = extractSitemapLocs(response.html).filter((url) => /\/sitemap\/product-\d+\.xml/i.test(url));
  return urls.length ? urls : [sitemapUrl];
}

function extractSitemapLocs(xml) {
  return Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi))
    .map((item) => cleanText(item[1]))
    .filter(Boolean);
}

function productLinkFromUrl(url) {
  return {
    url,
    text: titleFromUrl(url)
  };
}

async function fetchProduct(url) {
  const response = await fetchHtml(url);
  return response;
}

async function fetchHtml(url) {
  await waitForFetchSlot();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "upgrade-insecure-requests": "1",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
    return { url: response.url || url, html: await response.text() };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForFetchSlot() {
  const delay = Math.max(Number(process.env.WORKER_REQUEST_DELAY_MS || process.env.REQUEST_DELAY_MS) || 0, 0);
  if (!delay) return;
  const jitter = Math.floor(Math.random() * Math.min(700, delay));
  const run = fetchQueue.catch(() => null).then(async () => {
    const elapsed = Date.now() - lastFetchAt;
    const waitMs = Math.max(delay - elapsed, 0) + jitter;
    if (waitMs > 0) await sleep(waitMs);
    lastFetchAt = Date.now();
  });
  fetchQueue = run;
  await run;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseProductPage(html, url) {
  const text = htmlToLines(html);
  const title = cleanText(match(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || text.find((line) => line.length > 8) || "");
  const image = extractImage(html, url);
  const description = extractDescription(html, text);
  const platform = inferPlatform(title) || inferPlatform(text.slice(0, 120).join(" "));
  const variants = parseStructuredVariants(html) || parseVariants(text);

  return {
    title,
    url,
    image,
    description,
    platform,
    licenses: variants
  };
}

function parseStructuredVariants(html) {
  const options = Array.from(html.matchAll(/class=["'][^"']*\batributo-item\b[^"']*["'][^>]*data-variacao-id=["']([^"']+)["'][^>]*data-variacao-nome=["']([^"']+)["'][^>]*>/gi))
    .map((match) => ({
      id: match[1],
      name: cleanText(match[2])
    }));
  if (!options.length) return null;

  const priceBlocks = new Map();
  const actionPattern = /<div\b[^>]*class=["'][^"']*\bacoes-produto\b[^"']*["'][^>]*data-variacao-id=["']([^"']+)["'][^>]*>/gi;
  const actions = Array.from(html.matchAll(actionPattern)).map((match) => ({
    id: match[1],
    index: match.index
  }));

  actions.forEach((action, actionIndex) => {
    const nextIndex = actions[actionIndex + 1]?.index ?? html.indexOf('<span id="DelimiterFloat"', action.index);
    const block = html.slice(action.index, nextIndex > action.index ? nextIndex : action.index + 6000);
    const price = extractStructuredPrice(block);
    if (price !== null) priceBlocks.set(action.id, {
      price,
      available: !/\bindisponivel\b|OutOfStock|produto encontra-se indispon/i.test(normalize(block) + block)
    });
  });

  const licenses = { primary: { price: null }, secondary: { price: null } };
  let mapped = 0;
  for (const option of options) {
    if (isRental(option.name)) continue;
    const license = inferLicense(option.name);
    if (!license) continue;
    const payload = priceBlocks.get(option.id);
    if (!payload || typeof payload.price !== "number") continue;
    licenses[license].price = payload.price;
    licenses[license].available = payload.available;
    mapped += 1;
  }

  return mapped ? licenses : null;
}

function extractStructuredPrice(block) {
  const sellPrice = match(block, /data-sell-price=["']([0-9]+(?:\.[0-9]+)?)["']/i);
  if (sellPrice) return Number(sellPrice);
  const strong = match(block, /<strong[^>]*class=["'][^"']*\bpreco-promocional\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i);
  if (strong) return extractSalePrice(cleanText(strong));
  const metaPrice = match(block, /<meta[^>]+itemprop=["']price["'][^>]+content=["']([0-9]+(?:\.[0-9]+)?)["']/i);
  return metaPrice ? Number(metaPrice) : null;
}

function parseVariants(lines) {
  const licenses = { primary: { price: null }, secondary: { price: null } };
  const optionIndex = lines.findIndex((line) => /^Selecione a opção/i.test(line));

  if (optionIndex >= 0) {
    const rawOptions = [];
    for (let index = optionIndex + 1; index < Math.min(lines.length, optionIndex + 18); index += 1) {
      const line = lines[index];
      if (/^R\$\s*\d/i.test(line) || /^A partir/i.test(line) || /^Comprar$/i.test(line)) break;
      if (isPotentialOption(line)) rawOptions.push(line);
    }

    const prices = collectVariantPrices(lines, optionIndex + 1, rawOptions.length);

    rawOptions.forEach((option, index) => {
      if (isRental(option)) return;
      const license = inferLicense(option);
      if (!license) return;
      if (prices[index] !== undefined) licenses[license].price = prices[index];
    });
  }

  if (!licenses.primary.price && !licenses.secondary.price) {
    const licenseFromTitle = inferLicense(lines.slice(0, 20).join(" "));
    const firstPrice = lines.map((line, index) => isMainPriceLine(lines, index) ? extractSalePrice(line) : null).find((price) => price !== null);
    if (licenseFromTitle && firstPrice !== undefined) licenses[licenseFromTitle].price = firstPrice;
  }

  return licenses;
}

function isPotentialOption(line) {
  if (line.length > 80) return false;
  if (/^(Código|Marca|Comprar|Estoque|até|ou|R\$|A partir)/i.test(line)) return false;
  if (/^(M[ií]dia|Licen[cç]a|Digital|Vers[aã]o)\s*:?\s*$/i.test(line)) return false;
  if (/:$/.test(line) && !/(prim|sec|aluguel)/i.test(line)) return false;
  return /(prim|sec|m[ií]dia|licen|digital|ps4|ps5|xbox|switch|aluguel)/i.test(line);
}

function extractSalePrice(line) {
  const matches = Array.from(line.matchAll(/R\$\s*([0-9.]+,[0-9]{2})/g)).map((item) => parseMoney(item[1]));
  if (!matches.length) return null;
  return matches[matches.length - 1];
}

function collectVariantPrices(lines, startIndex, expectedCount) {
  const prices = [];
  const endIndex = Math.min(lines.length, startIndex + 100);
  for (let index = startIndex; index < endIndex; index += 1) {
    const line = lines[index];
    if (/^A partir/i.test(line) && prices.length) break;
    if (!isMainPriceLine(lines, index)) continue;
    if (isMainPriceLine(lines, index + 1)) continue;
    prices.push(extractSalePrice(line));
    if (expectedCount && prices.length >= expectedCount) break;
  }
  return prices;
}

function isMainPriceLine(lines, index) {
  const line = lines[index];
  if (!/R\$\s*[0-9.]+,[0-9]{2}/.test(line)) return false;
  const context = lines.slice(Math.max(0, index - 4), index + 1).join(" ");
  const previous = lines.slice(Math.max(0, index - 3), index).join(" ");
  const next = lines.slice(index + 1, index + 4).join(" ");
  if (/\bou\b/i.test(previous) || /via Pix/i.test(`${line} ${next}`)) return false;
  if (/(até|parcela|parcelas|\dx|sem juros)\s+(de\s+)?R\$/i.test(context)) return false;
  if (/\dx\s+de\s+R\$/i.test(context)) return false;
  return true;
}

function extractProductLinks(html, baseUrl) {
  const links = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let anchor;
  while ((anchor = anchorPattern.exec(html))) {
    const href = anchor[1];
    const text = cleanText(anchor[2]);
    const url = toAbsoluteUrl(href, baseUrl);
    if (!url || !isLikelyProductUrl(url, baseUrl, text)) continue;
    links.push({ url, text });
  }
  return uniqueBy(links, (item) => item.url);
}

function getTagAttribute(attrs, name) {
  const pattern = new RegExp(`${name}=["']([^"']+)["']`, "i");
  return match(attrs, pattern);
}

function isLikelyProductUrl(url, baseUrl, text) {
  const parsed = new URL(url);
  const base = new URL(baseUrl);
  const combined = `${url} ${text}`.toLowerCase();
  if (combined.includes("--produto") || combined.includes("{produto") || combined.includes("carrinho_quantidade")) return false;
  if (parsed.hostname !== base.hostname) return false;
  const path = parsed.pathname.toLowerCase();
  const blocked = ["/carrinho", "/conta", "/login", "/categoria", "/marca", "/playstation", "/xbox", "/nintendo", "/buscar", "/politica", "/quem-somos", "/fale-conosco", "/novidades", "/ofertas"];
  if (blocked.some((item) => path.startsWith(item))) return false;
  if (path === "/" || path.length < 6) return false;
  const segmentCount = path.split("/").filter(Boolean).length;
  return segmentCount === 1 && (path.includes("-") || /midia|m[ií]dia|digital|ps4|ps5|xbox|switch/i.test(`${path} ${text}`));
}

function scoreCandidate(candidate, ownProduct, options = {}) {
  const candidateText = normalize(`${candidate.text || ""} ${candidate.title || ""} ${candidate.description || ""} ${candidate.url || ""}`);
  if (isRental(candidateText)) return 0;
  const ownPlatform = normalize(ownProduct.platform || "");
  const candidatePlatforms = platformsIn(candidateText);
  if (ownPlatform && candidatePlatforms.size && !candidatePlatforms.has(ownPlatform)) return 0;

  const ownTokens = gameTokens(`${ownProduct.title || ""} ${ownProduct.description || ""}`);
  const candidateTokens = new Set(gameTokens(candidateText));
  const comparableCandidateTokens = comparableTokenSet(candidateTokens);
  const ownTitleTokens = gameTokens(ownProduct.title);
  const candidateTitleSource = cleanText(`${candidate.text || ""} ${candidate.title || ""}`) || candidate.url || "";
  const candidateTitleTokens = new Set(gameTokens(candidateTitleSource));
  const ownTitleNumbers = titleNumberTokens(ownTitleTokens);
  const candidateTitleNumbers = titleNumberTokens(Array.from(candidateTitleTokens));
  if (Array.from(ownTitleNumbers).some((token) => !candidateTitleNumbers.has(token) && !candidateTokens.has(token))) return 0;
  if (Array.from(candidateTitleNumbers).some((token) => !ownTitleNumbers.has(token))) return 0;
  if ((ownTokens.includes("fc") || ownTokens.includes("fifa")) && !(candidateTokens.has("fc") || candidateTokens.has("fifa"))) return 0;
  if (ownTokens.includes("gta") && ownTokens.includes("5") && candidateTokens.has("trilogy")) return 0;
  if (!titleCoverageAccepted(ownTitleTokens, candidateTitleTokens)) return 0;
  if (!coreTitleAgreementAccepted(ownTitleTokens, candidateTitleTokens)) return 0;
  if (!franchiseSubtitleCompatible(ownTitleTokens, candidateTitleTokens)) return 0;
  if (hasConflictingExtraEdition(ownTitleTokens, candidateTitleTokens)) return 0;

  let tokenScore = 0;
  let meaningfulMatches = 0;
  for (const token of ownTokens) {
    if (!comparableCandidateTokens.has(token)) continue;
    tokenScore += token.length >= 4 ? 2 : 1;
    if (!/^\d+$/.test(token)) meaningfulMatches += 1;
  }
  const minimumTokenScore = options.preview ? 3 : (ownTitleTokens.length <= 2 ? 2 : 6);
  if (!meaningfulMatches || tokenScore < minimumTokenScore) return 0;

  let score = tokenScore;
  score += titleCoverageScore(ownTitleTokens, candidateTitleTokens);
  score += editionCompatibilityScore(ownTitleTokens, candidateTitleTokens);
  if (ownPlatform && candidatePlatforms.has(ownPlatform)) score += 5;
  if (imageLooksRelated(ownProduct.image, candidate.image)) score += 3;
  if (candidate.description && titleCoverageAccepted(ownTitleTokens, new Set(gameTokens(candidate.description)))) score += 2;
  return score;
}

function titleCoverageAccepted(ownTokens, candidateTokens) {
  return titleCoverageScore(ownTokens, candidateTokens) >= 8;
}

function coreTitleAgreementAccepted(ownTokens, candidateTokens) {
  const coreOwn = coreTitleTokens(ownTokens);
  if (!coreOwn.length) return true;
  const comparableCandidate = comparableTokenSet(candidateTokens);
  return coreOwn.some((token) => comparableCandidate.has(token) || comparableCandidate.has(ROMAN_NUMERALS[token]));
}

function coreTitleTokens(tokens) {
  return uniqueBy(tokens, (token) => token)
    .filter((token) => !/^\d+$/.test(ROMAN_NUMERALS[token] || token))
    .filter((token) => !LOOSE_TITLE_TOKENS.has(token))
    .filter((token) => !EDITION_TOKENS.has(token));
}

function franchiseSubtitleCompatible(ownTokens, candidateTokens) {
  const ownSet = new Set(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (ownSet.has("call") && ownSet.has("duty") && candidateSet.has("call") && candidateSet.has("duty")) {
    const subtitle = ownTokens.filter((token) => !CALL_OF_DUTY_BASE_TOKENS.has(token) && !/^\d+$/.test(token));
    return subtitle.every((token) => candidateSet.has(token));
  }
  return true;
}

function titleNumberTokens(tokens) {
  const numbers = new Set();
  for (const token of tokens) {
    const normalized = ROMAN_NUMERALS[token] || token;
    if (!/^\d+$/.test(normalized)) continue;
    numbers.add(normalized);
    for (const variant of seasonNumberVariants(normalized)) numbers.add(variant);
  }
  return numbers;
}

function titleCoverageScore(ownTokens, candidateTokens) {
  const distinctOwn = uniqueBy(ownTokens, (token) => token)
    .filter((token) => !LOOSE_TITLE_TOKENS.has(token));
  if (!distinctOwn.length) return 0;
  const comparableCandidate = comparableTokenSet(candidateTokens);
  const matches = distinctOwn.filter((token) => comparableCandidate.has(token) || comparableCandidate.has(ROMAN_NUMERALS[token]));
  const coverage = matches.length / distinctOwn.length;
  if (distinctOwn.length <= 2) return coverage === 1 ? 12 : 0;
  if (distinctOwn.length <= 4) return coverage >= 0.75 ? Math.round(12 * coverage) : 0;
  return coverage >= 0.68 ? Math.round(12 * coverage) : 0;
}

function comparableTokenSet(tokens) {
  const comparable = new Set(tokens);
  for (const token of tokens) {
    if (ROMAN_NUMERALS[token]) comparable.add(ROMAN_NUMERALS[token]);
    for (const variant of seasonNumberVariants(token)) comparable.add(variant);
  }
  return comparable;
}

function seasonNumberVariants(token) {
  if (/^\d{2}$/.test(token)) {
    const year = Number(token);
    if (year <= 35) return [`20${token}`];
  }
  if (/^20\d{2}$/.test(token)) {
    const year = Number(token.slice(2));
    if (year <= 35) return [String(year).padStart(2, "0").replace(/^0/, "")];
  }
  return [];
}

function editionCompatibilityScore(ownTokens, candidateTokens) {
  const ownEditions = ownTokens.filter((token) => EDITION_TOKENS.has(token));
  const candidateEditions = Array.from(candidateTokens).filter((token) => EDITION_TOKENS.has(token));
  let score = 0;
  for (const token of ownEditions) {
    score += candidateTokens.has(token) ? 2 : -3;
  }
  const extraCandidate = candidateEditions.filter((token) => !ownTokens.includes(token) && token !== "standard");
  score -= extraCandidate.length * 10;
  return score;
}

function hasConflictingExtraEdition(ownTokens, candidateTokens) {
  const ownSet = new Set(ownTokens);
  return Array.from(candidateTokens)
    .some((token) => STRONG_EXTRA_EDITION_TOKENS.has(token) && !ownSet.has(token));
}

function imageLooksRelated(ownImage, candidateImage) {
  if (!ownImage || !candidateImage) return false;
  const own = imageKey(ownImage);
  const candidate = imageKey(candidateImage);
  if (!own || !candidate) return false;
  return own === candidate || own.split("-").some((part) => part.length >= 6 && candidate.includes(part));
}

function buildSearchQueries(product) {
  const base = cleanSearchQuery(cleanText(product.title)
    .replace(/m[ií]dia digital/gi, "")
    .replace(/\b(ps4|ps5)\b/gi, product.platform || "$1")
  );
  const aliases = aliasQueries(base);
  return uniqueBy([base, ...aliases], normalize).filter(Boolean).slice(0, 6);
}

function cleanSearchQuery(value) {
  return value
    .replace(/[()]/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aliasQueries(query) {
  const normalized = normalize(query);
  const aliases = [];
  if (/\bgta\b|\bgrand theft auto\b/.test(normalized)) {
    aliases.push(query.replace(/\bGTA\s*5\b/i, "Grand Theft Auto V"));
    aliases.push(query.replace(/\bGrand Theft Auto V\b/i, "GTA 5"));
    aliases.push(query.replace(/\bGTA\s*5\b/i, "GTA V"));
  }
  if (/\bea sports fc\b|\bfc\s*\d{2}\b|\bfifa\s*\d{2}\b/.test(normalized)) {
    aliases.push(query.replace(/EA Sports FC/i, "EA FC").replace(/\(FIFA\s*(\d{2})\)/i, ""));
    aliases.push(query.replace(/EA Sports FC\s*(\d{2})/i, "FIFA $1"));
  }
  if (/\bpart\s+(ii|2)\s+2\b/.test(normalized)) {
    aliases.push(query.replace(/\bPart\s+II\s+2\b/i, "Part II"));
    aliases.push(query.replace(/\bPart\s+II\s+2\b/i, "Part 2"));
  }
  return aliases;
}

function htmlToLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|li|p|h1|h2|h3|div|section|article|tr|td|option|span|strong|del|ins|small|b)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map(cleanText)
    .filter(Boolean);
}

function cleanText(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractImage(html, url) {
  const image = match(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || match(html, /<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  return image ? toAbsoluteUrl(image, url) : "";
}

function extractDescription(html, lines) {
  const meta = match(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || match(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  if (meta) return cleanText(meta).slice(0, 500);
  return lines.slice(0, 80).join(" ").slice(0, 500);
}

function inferPlatform(value) {
  const text = normalize(value);
  if (/\bps5\b|playstation 5/.test(text)) return "PS5";
  if (/\bps4\b|playstation 4/.test(text)) return "PS4";
  if (/\bps3\b|playstation 3/.test(text)) return "PS3";
  if (/xbox series/.test(text)) return "Xbox Series";
  if (/xbox one/.test(text)) return "Xbox One";
  if (/switch/.test(text)) return "Switch";
  return "";
}

function inferLicense(value) {
  const text = normalize(value);
  if (/secundaria|secundario|\bsec\b/.test(text)) return "secondary";
  if (/primaria|primario|\bprim\b/.test(text)) return "primary";
  return null;
}

function isRental(value) {
  return /aluguel|10\+1|temporar|dias/.test(normalize(value));
}

function parseMoney(value) {
  return Number(String(value).replace(/\./g, "").replace(",", "."));
}

function normalizeManualItem(item) {
  return {
    title: item.title,
    url: item.url,
    image: item.image || "",
    platform: item.platform || inferPlatform(item.title),
    licenses: {
      primary: { price: item.licenses?.primary?.myPrice ?? item.licenses?.primary?.price ?? null },
      secondary: { price: item.licenses?.secondary?.myPrice ?? item.licenses?.secondary?.price ?? null }
    }
  };
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function gameTokens(value) {
  return expandAliases(tokenize(value))
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => token.length >= 2 || /^\d+$/.test(token));
}

function expandAliases(tokens) {
  const expanded = [...tokens];
  const joined = tokens.join(" ");
  if (tokens.includes("gta") && (tokens.includes("5") || tokens.includes("v"))) expanded.push("grand", "theft", "auto", "5");
  if (/grand theft auto/.test(joined)) expanded.push("gta");
  if (/grand theft auto/.test(joined) && (tokens.includes("v") || tokens.includes("5"))) expanded.push("5");
  if (tokens.includes("fifa") || tokens.includes("fc")) expanded.push("fifa", "fc");
  return uniqueBy(expanded, (token) => token);
}

function platformsIn(value) {
  const text = normalize(value);
  const platforms = new Set();
  if (/\bps5\b|playstation 5/.test(text)) platforms.add("ps5");
  if (/\bps4\b|playstation 4/.test(text)) platforms.add("ps4");
  if (/\bps3\b|playstation 3/.test(text)) platforms.add("ps3");
  if (/xbox series/.test(text)) platforms.add("xbox series");
  if (/xbox one/.test(text)) platforms.add("xbox one");
  if (/switch/.test(text)) platforms.add("switch");
  return platforms;
}

function slugify(value) {
  return normalize(value).replace(/\s+/g, "-").slice(0, 80);
}

function titleFromUrl(value) {
  try {
    const parsed = new URL(value);
    const segment = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return cleanText(segment
      .replace(/-/g, " ")
      .replace(/\bmidia\b/gi, " midia ")
      .replace(/\bdigital\b/gi, " digital "));
  } catch {
    return "";
  }
}

function imageKey(value) {
  try {
    const parsed = new URL(value);
    return normalize(parsed.pathname.split("/").pop() || "").replace(/\s+/g, "-");
  } catch {
    return "";
  }
}

function toAbsoluteUrl(href, baseUrl) {
  try {
    const url = new URL(href, baseUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function match(value, pattern) {
  const result = value.match(pattern);
  return result ? result[1] : "";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function json(payload, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(payload)
  };
}

const STOP_WORDS = new Set([
  "midia",
  "digital",
  "ps4",
  "ps5",
  "ps3",
  "playstation",
  "xbox",
  "one",
  "series",
  "nintendo",
  "switch",
  "fifa",
  "jogo",
  "games",
  "game",
  "for",
  "the",
  "of",
  "and",
  "ea",
  "sports",
  "edition",
  "edicao",
  "versao",
  "psn"
]);

const LOOSE_TITLE_TOKENS = new Set([
  "remaster",
  "remastered",
  "edition",
  "edicao",
  "standard",
  "midia",
  "digital"
]);

const EDITION_TOKENS = new Set([
  "gold",
  "ultimate",
  "deluxe",
  "complete",
  "collection",
  "colecao",
  "trilogy",
  "bundle",
  "legendary",
  "definitive",
  "remake",
  "remaster",
  "remastered",
  "champions",
  "premium",
  "standard"
]);

const CALL_OF_DUTY_BASE_TOKENS = new Set(["call", "duty", "cod"]);

const STRONG_EXTRA_EDITION_TOKENS = new Set([
  "gold",
  "ultimate",
  "deluxe",
  "complete",
  "collection",
  "colecao",
  "trilogy",
  "bundle",
  "legendary",
  "definitive",
  "remake",
  "remaster",
  "remastered",
  "champions",
  "premium"
]);

const ROMAN_NUMERALS = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10"
};

module.exports.buildReport = buildReport;
module.exports.saveReport = saveReport;
module.exports.saveReportWithStatus = saveReportWithStatus;
module.exports.getSavedReport = getSavedReport;
module.exports.saveCatalogItems = saveCatalogItems;
module.exports.getCatalogItems = getCatalogItems;
module.exports.discoverOwnProducts = discoverOwnProducts;
module.exports.discoverCompetitorCatalogs = discoverCompetitorCatalogs;
module.exports.discoverCompetitorCatalog = discoverCompetitorCatalog;
module.exports.getReviewOverrides = getReviewOverrides;
module.exports.saveReviewOverrides = saveReviewOverrides;
module.exports.recordReviewDecision = recordReviewDecision;
module.exports.getReviewCandidates = getReviewCandidates;
module.exports.setRefreshStatus = setRefreshStatus;
module.exports.getRefreshStatus = getRefreshStatus;
module.exports.COMPETITORS = COMPETITORS;

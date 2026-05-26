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
const CACHE_TTL = {
  report: 10 * 1000,
  catalog: 30 * 60 * 1000,
  parsedProduct: 30 * 60 * 1000
};
const memoryCache = new Map();

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
    if (!ownProduct || !ownProduct.title) {
      throw new Error(`Produto Nexus sem titulo legivel: ${tracked?.url || tracked?.text || "item desconhecido"}`);
    }

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
        const competitorLicenses = licensesForPlatform(match, ownProduct.platform);
        const variant = competitorLicenses?.[license];
        const available = variant?.available !== false;
        licenses[license].competitors[competitor.id] = {
          price: available ? (variant?.price ?? null) : null,
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
  memoryCache.set("latest-report", { value: report, expiresAt: Date.now() + CACHE_TTL.report });
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
  memoryCache.set("latest-report", { value: report, expiresAt: Date.now() + CACHE_TTL.report });
  await store.setJSON("refresh-status", {
    updatedAt: new Date().toISOString(),
    ...status
  });
}

async function getSavedReport() {
  return cachedValue("latest-report", CACHE_TTL.report, async () => {
    const store = await getBlobStore();
    return store.get("latest-report", { type: "json", consistency: "strong" });
  });
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
    decisions: {},
    learning: defaultReviewLearning()
  };
}

function defaultReviewLearning() {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    examples: []
  };
}

async function getReviewOverrides() {
  const store = await getBlobStore();
  const overrides = await store.get("match-overrides", { type: "json", consistency: "strong" }) || defaultReviewOverrides();
  return hydrateReviewLearning(overrides);
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
  if ((input.action === "confirm" || input.action === "choose") && !input.competitorUrl) {
    throw new Error("Link do concorrente e obrigatorio para confirmar");
  }

  const decisions = overrides.decisions || {};
  const now = new Date().toISOString();
  const relatedInputs = await relatedReviewDecisionInputs(input, ownUrl, competitorId).catch(() => ([{
    ownUrl,
    competitorUrl: input.competitorUrl || ""
  }]));
  const appliedDecisions = [];

  for (const related of relatedInputs) {
    const ownKey = reviewKey(related.ownUrl);
    const current = decisions[ownKey]?.[competitorId] || {};
    const next = buildReviewDecision(current, input, related, now);

    decisions[ownKey] = {
      ...(decisions[ownKey] || {}),
      [competitorId]: next
    };
    appliedDecisions.push({
      action: input.action,
      ownUrl: related.ownUrl,
      competitorId,
      competitorUrl: related.competitorUrl || "",
      savedAt: now
    });
  }

  const learning = await buildReviewLearning(overrides, input, relatedInputs, now).catch(() => overrides.learning || defaultReviewLearning());
  const saved = await saveReviewOverrides({ ...overrides, decisions, learning });
  const reportUpdates = await applyReviewDecisionToSavedReport(input, relatedInputs, now).catch(() => []);
  return {
    ...saved,
    appliedDecisions: appliedDecisions.map((decision) => ({
      ...decision,
      candidate: reportUpdates.find((item) => item.ownUrl === decision.ownUrl && item.competitorId === decision.competitorId)?.candidate || null
    }))
  };
}

async function applyReviewDecisionToSavedReport(input, relatedInputs, now) {
  const report = await getSavedReport().catch(() => null);
  if (!report?.items?.length) return [];
  const status = await getRefreshStatus().catch(() => null);
  if (status?.status === "running") return [];

  const parsedCache = new Map();
  const updates = [];
  let changed = false;

  for (const related of relatedInputs) {
    const item = (report.items || []).find((product) => normalizeReviewUrl(product.url) === normalizeReviewUrl(related.ownUrl));
    if (!item) continue;
    const candidate = await candidateProductFromReviewInput(input, related, item, parsedCache).catch(() => null);
    const applied = applyReviewDecisionToSavedReportItem(item, input, related, candidate, now);
    if (!applied) continue;
    changed = true;
    updates.push({
      ownUrl: related.ownUrl,
      competitorId: input.competitorId,
      candidate: candidate ? reviewCandidateSnapshot(candidate, item.platform) : null
    });
  }

  if (!changed) return updates;
  await saveReportWithStatus(report, {
    ...(status || {}),
    status: "ready",
    updatedAt: new Date().toISOString(),
    items: report.items.length,
    totalItems: report.totalItems,
    message: status?.message || "Relatório atualizado por revisão manual"
  });
  return updates;
}

async function candidateProductFromReviewInput(input, related, item, parsedCache) {
  const competitorUrl = related.competitorUrl || input.competitorUrl || "";
  if (!competitorUrl || input.action === "missing-today" || input.action === "wrong") return null;
  if (input.candidate && sameNormalizedUrl(input.candidate.url, competitorUrl)) {
    return {
      title: input.candidate.title || titleFromUrl(competitorUrl),
      url: competitorUrl,
      image: input.candidate.image || "",
      platform: input.candidate.platform || inferPlatform(`${input.candidate.title || ""} ${competitorUrl}`),
      licenses: input.candidate.licenses || { primary: { price: null }, secondary: { price: null } },
      platformLicenses: input.candidate.platformLicenses || {}
    };
  }
  const parsed = await getParsedCompetitorProduct(competitorUrl, parsedCache);
  return {
    ...parsed,
    licenses: licensesForPlatform(parsed, item.platform)
  };
}

function applyReviewDecisionToSavedReportItem(item, input, related, candidate, now) {
  const competitorId = input.competitorId;
  const competitorUrl = related.competitorUrl || input.competitorUrl || "";
  let changed = false;
  for (const [licenseKey, license] of Object.entries(item.licenses || {})) {
    license.competitors = license.competitors || {};
    const current = license.competitors[competitorId] || {};
    if (input.action === "wrong" && competitorUrl && current.url && !sameNormalizedUrl(current.url, competitorUrl)) continue;

    const next = { ...current };
    if (input.action === "missing-today") {
      next.price = null;
      next.available = false;
      next.review = reviewStatusPayload("missing-today", now);
    } else if (input.action === "wrong") {
      next.available = false;
      next.review = reviewStatusPayload("wrong", now);
    } else if ((input.action === "confirm" || input.action === "choose") && competitorUrl && candidate) {
      const variant = candidate.licenses?.[licenseKey] || {};
      const available = variant.available !== false;
      next.price = available ? (variant.price ?? null) : null;
      next.url = candidate.url || competitorUrl;
      next.title = candidate.title || next.title || titleFromUrl(competitorUrl);
      next.available = variant.available;
      next.note = variant.price
        ? (variant.available === false ? "Variacao indisponivel no concorrente" : undefined)
        : candidate.note || "Licença não anunciada nessa página";
      next.review = reviewStatusPayload("confirmed", now);
    } else {
      continue;
    }

    license.competitors[competitorId] = next;
    changed = true;
  }
  return changed;
}

function reviewStatusPayload(status, now) {
  if (status === "missing-today") {
    return {
      status,
      confidence: 70,
      label: "Marcado sem produto hoje",
      reasons: ["Você marcou que não encontrou hoje"],
      updatedAt: now
    };
  }
  if (status === "wrong") {
    return {
      status,
      confidence: 1,
      label: "Marcado incorreto",
      reasons: ["Você marcou este par como errado"],
      updatedAt: now
    };
  }
  return {
    status: "confirmed",
    confidence: 100,
    label: "Confirmado por você",
    reasons: ["Vinculo salvo manualmente"],
    updatedAt: now
  };
}

function reviewCandidateSnapshot(candidate, platform) {
  return {
    url: candidate.url,
    title: candidate.title,
    image: candidate.image || "",
    platform: candidate.platform || "",
    licenses: licensesForPlatform(candidate, platform)
  };
}

function buildReviewDecision(current, input, related, now) {
  const competitorUrl = related.competitorUrl || "";
  const next = {
    ...current,
    ownUrl: related.ownUrl,
    competitorId: input.competitorId,
    updatedAt: now,
    history: [
      ...(current.history || []).slice(-20),
      {
        action: input.action,
        competitorUrl,
        note: input.note || "",
        createdAt: now
      }
    ]
  };

  if (input.action === "confirm" || input.action === "choose") {
    next.confirmedUrl = competitorUrl;
    next.confirmedAt = now;
    next.noTodayAt = "";
  }

  if (input.action === "wrong") {
    if (competitorUrl) {
      next.rejectedUrls = {
        ...(next.rejectedUrls || {}),
        [normalizeReviewUrl(competitorUrl)]: { rejectedAt: now, note: input.note || "" }
      };
      if (normalizeReviewUrl(next.confirmedUrl) === normalizeReviewUrl(competitorUrl)) next.confirmedUrl = "";
    }
  }

  if (input.action === "missing-today") {
    next.noTodayAt = now;
  }

  return next;
}

async function relatedReviewDecisionInputs(input, ownUrl, competitorId) {
  const report = await getSavedReport();
  const source = (report?.items || []).find((item) => normalizeReviewUrl(item.url) === normalizeReviewUrl(ownUrl));
  if (!source) return [{ ownUrl, competitorUrl: input.competitorUrl || "" }];
  const familyKey = reviewFamilyKey(source);
  if (!familyKey) return [{ ownUrl, competitorUrl: input.competitorUrl || "" }];

  const related = [];
  for (const item of (report.items || [])
    .filter((item) => reviewFamilyKey(item) === familyKey)
    .filter((item) => shouldShareReviewFamily(source, item))) {
    if (normalizeReviewUrl(item.url) === normalizeReviewUrl(ownUrl)) {
      related.push({ ownUrl: item.url, competitorUrl: input.competitorUrl || "" });
      continue;
    }

    let competitorUrl = "";
    if (input.action === "choose") {
      competitorUrl = await findRelatedChosenCompetitorUrl(input, source, item, competitorId).catch(() => "");
    }
    if (!competitorUrl) competitorUrl = reviewCompetitorUrlForItem(item, competitorId);
    if (input.action !== "missing-today" && !competitorUrl) continue;
    related.push({ ownUrl: item.url, competitorUrl });
  }
  return related;
}

function reviewCompetitorUrlForItem(item, competitorId) {
  for (const license of Object.values(item.licenses || {})) {
    const url = license?.competitors?.[competitorId]?.url;
    if (url) return url;
  }
  return "";
}

async function findRelatedChosenCompetitorUrl(input, sourceItem, targetItem, competitorId) {
  const competitor = COMPETITORS.find((item) => item.id === competitorId);
  if (!competitor) return "";
  const sourcePlatform = reviewPlatformKey(sourceItem);
  const targetPlatform = reviewPlatformKey(targetItem);
  if (!sourcePlatform || !targetPlatform || sourcePlatform === targetPlatform) return "";

  const targetProduct = normalizeManualItem(targetItem);
  const catalog = await discoverCompetitorCatalog(competitor);
  const targetQuery = relatedPlatformQuery(input.candidate?.title || input.competitorUrl || targetProduct.title, targetPlatform);
  const parsedCache = new Map();
  const ranked = uniqueBy(catalog, (item) => item.url)
    .map((link) => {
      const queryScore = targetQuery ? queryCandidateScore(link, targetQuery) : 0;
      const matchScore = scoreCandidate(link, targetProduct, { preview: true });
      return { ...link, score: matchScore + queryScore };
    })
    .filter((link) => link.score >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(process.env.CATALOG_CANDIDATE_LIMIT || 8));

  const validated = [];
  for (const candidate of ranked) {
    try {
      const product = await getParsedCompetitorProduct(candidate.url, parsedCache);
      const score = scoreCandidate(product, targetProduct);
      if (score >= 16) validated.push({ product, score: score + queryCandidateScore(product, targetQuery) });
    } catch {
      // Keep looking for the related platform product.
    }
  }
  return bestValidatedProduct(validated)?.url || "";
}

function relatedPlatformQuery(value, targetPlatform) {
  const label = targetPlatform === "ps5" ? "PS5" : targetPlatform === "ps4" ? "PS4" : "";
  const number = targetPlatform === "ps5" ? "5" : targetPlatform === "ps4" ? "4" : "";
  return cleanSearchQuery(cleanText(value || "")
    .replace(/\bps[45]\b/gi, label || "$&")
    .replace(/playstation\s*[45]/gi, number ? `PlayStation ${number}` : "$&"));
}

async function buildReviewLearning(overrides, input, relatedInputs, now) {
  const learning = normalizeReviewLearning(overrides.learning);
  if (!["confirm", "choose", "wrong"].includes(input.action)) return learning;

  const report = await getSavedReport().catch(() => null);
  const examples = [];
  const parsedCache = new Map();
  for (const related of relatedInputs) {
    if (!related.competitorUrl) continue;
    const ownItem = (report?.items || []).find((item) => normalizeReviewUrl(item.url) === normalizeReviewUrl(related.ownUrl));
    const ownProduct = ownItem ? normalizeManualItem(ownItem) : await getOwnProductForReview(related.ownUrl).catch(() => null);
    if (!ownProduct?.title) continue;
    const candidateProduct = await getParsedCompetitorProduct(related.competitorUrl, parsedCache).catch(() => null);
    if (!candidateProduct?.title) continue;
    examples.push(buildReviewLearningExample({
      action: input.action === "wrong" ? "negative" : "positive",
      ownProduct,
      candidateProduct,
      competitorId: input.competitorId,
      createdAt: now
    }));
  }
  if (!examples.length) return learning;
  const merged = mergeReviewLearningExamples(learning.examples, examples);
  return {
    ...learning,
    updatedAt: now,
    examples: merged
  };
}

function normalizeReviewLearning(learning) {
  return {
    ...defaultReviewLearning(),
    ...(learning || {}),
    examples: Array.isArray(learning?.examples) ? learning.examples.slice(-1000) : []
  };
}

function buildReviewLearningExample({ action, ownProduct, candidateProduct, competitorId, createdAt }) {
  const ownTokens = coreTitleTokens(gameTokens(ownProduct.title || ""));
  const candidateTokens = coreTitleTokens(gameTokens(candidateProduct.title || candidateProduct.url || ""));
  const ownTokenSet = comparableTokenSet(ownTokens);
  const candidateTokenSet = comparableTokenSet(candidateTokens);
  const sharedTokens = ownTokens.filter((token) => candidateTokenSet.has(token));
  const ownMissingTokens = ownTokens.filter((token) => !candidateTokenSet.has(token));
  const candidateExtraTokens = candidateTokens.filter((token) => !ownTokenSet.has(token));
  return {
    id: [
      action,
      competitorId,
      reviewFamilyKey(ownProduct),
      normalizeReviewUrl(candidateProduct.url)
    ].join(":"),
    action,
    competitorId,
    ownUrl: ownProduct.url,
    ownTitle: ownProduct.title,
    ownPlatform: ownProduct.platform || "",
    ownFamilyKey: reviewFamilyKey(ownProduct),
    ownTokens,
    candidateUrl: candidateProduct.url,
    candidateTitle: candidateProduct.title,
    candidatePlatform: candidateProduct.platform || "",
    candidateFamilyKey: reviewFamilyKey(candidateProduct),
    candidateTokens,
    sharedTokens,
    ownMissingTokens,
    candidateExtraTokens,
    createdAt
  };
}

function mergeReviewLearningExamples(current, next) {
  const byId = new Map();
  for (const example of [...(current || []), ...next]) {
    if (!example?.id) continue;
    byId.set(example.id, example);
  }
  return Array.from(byId.values()).slice(-1000);
}

async function hydrateReviewLearning(overrides) {
  const normalized = {
    ...defaultReviewOverrides(),
    ...(overrides || {}),
    learning: normalizeReviewLearning(overrides?.learning)
  };
  if (normalized.learning.examples.length) return normalized;

  const report = await getSavedReport().catch(() => null);
  const examples = buildReviewLearningExamplesFromDecisions(normalized.decisions, report);
  if (!examples.length) return normalized;
  return {
    ...normalized,
    learning: {
      ...normalized.learning,
      updatedAt: normalized.updatedAt || new Date().toISOString(),
      examples
    }
  };
}

function buildReviewLearningExamplesFromDecisions(decisions, report) {
  if (!decisions || !report?.items?.length) return [];
  const examples = [];
  for (const [ownUrl, byCompetitor] of Object.entries(decisions)) {
    const ownProduct = (report.items || []).find((item) => normalizeReviewUrl(item.url) === normalizeReviewUrl(ownUrl));
    if (!ownProduct?.title) continue;
    for (const [competitorId, decision] of Object.entries(byCompetitor || {})) {
      if (decision.confirmedUrl) {
        const candidateProduct = productSnapshotFromReport(ownProduct, competitorId, decision.confirmedUrl);
        examples.push(buildReviewLearningExample({
          action: "positive",
          ownProduct: normalizeManualItem(ownProduct),
          candidateProduct,
          competitorId,
          createdAt: decision.confirmedAt || decision.updatedAt || new Date().toISOString()
        }));
      }
      for (const [rejectedUrl, payload] of Object.entries(decision.rejectedUrls || {})) {
        const candidateProduct = productSnapshotFromReport(ownProduct, competitorId, rejectedUrl);
        examples.push(buildReviewLearningExample({
          action: "negative",
          ownProduct: normalizeManualItem(ownProduct),
          candidateProduct,
          competitorId,
          createdAt: payload?.rejectedAt || decision.updatedAt || new Date().toISOString()
        }));
      }
    }
  }
  return mergeReviewLearningExamples([], examples);
}

function productSnapshotFromReport(ownProduct, competitorId, competitorUrl) {
  const snapshots = Object.values(ownProduct.licenses || {})
    .map((license) => license?.competitors?.[competitorId])
    .filter(Boolean);
  const snapshot = snapshots.find((item) => sameNormalizedUrl(item.url, competitorUrl)) || snapshots[0] || {};
  const title = snapshot.title || titleFromUrl(competitorUrl);
  return {
    title,
    url: competitorUrl,
    image: snapshot.image || "",
    platform: snapshot.platform || inferPlatform(`${title} ${competitorUrl}`),
    licenses: {
      primary: { price: null },
      secondary: { price: null }
    }
  };
}

function sameNormalizedUrl(left, right) {
  return normalizeReviewUrl(left) === normalizeReviewUrl(right);
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

function reviewFamilyKey(item) {
  const tokens = normalize(item?.title || "")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !REVIEW_FAMILY_IGNORED_TOKENS.has(token));
  return tokens.join(" ");
}

function shouldShareReviewFamily(source, item) {
  const sourcePlatform = reviewPlatformKey(source);
  if (sourcePlatform === "ps4" || sourcePlatform === "ps5") {
    const targetPlatform = reviewPlatformKey(item);
    return targetPlatform === "ps4" || targetPlatform === "ps5";
  }
  return source?.url === item?.url;
}

function reviewPlatformKey(item) {
  const text = normalize(`${item?.platform || ""} ${item?.title || ""}`);
  if (/\bps5\b|playstation 5/.test(text)) return "ps5";
  if (/\bps4\b|playstation 4/.test(text)) return "ps4";
  return "";
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

async function setRefreshControl(control) {
  const store = await getBlobStore();
  const payload = {
    updatedAt: new Date().toISOString(),
    ...control
  };
  await store.setJSON("refresh-control", payload, {
    metadata: { updatedAt: payload.updatedAt, action: payload.action || "" }
  });
  return payload;
}

async function getRefreshControl() {
  const store = await getBlobStore();
  return store.get("refresh-control", { type: "json", consistency: "strong" });
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

async function findCompetitorProduct(competitor, ownProduct, reviewOverrides = defaultReviewOverrides()) {
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
    .map((link) => ({ ...link, score: scoreCandidateWithLearning(link, ownProduct, competitor.id, reviewOverrides, { preview: true }) }))
    .filter((link) => link.score >= 7)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  const validated = [];
  for (const candidate of ranked) {
    try {
      const productPage = await fetchProduct(candidate.url);
      const product = parseProductPage(productPage.html, productPage.url);
      const score = scoreCandidateWithLearning(product, ownProduct, competitor.id, reviewOverrides);
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
      return { match: manualProduct, source: "manual-confirmed", decision };
    } catch {
      // If the saved URL disappeared, fall through to automatic matching.
    }
  }

  if (Array.isArray(catalog) && catalog.length) {
    const indexedMatch = await findCompetitorProductFromCatalog(competitor, ownProduct, catalog, parsedCache, decision, reviewOverrides);
    if (indexedMatch?.match) return indexedMatch;
  }
  const fallback = await findCompetitorProduct(competitor, ownProduct, reviewOverrides);
  return { match: fallback, source: fallback ? "search-fallback" : "not-found", decision };
}

async function findCompetitorProductFromCatalog(competitor, ownProduct, catalog, parsedCache = new Map(), decision = null, reviewOverrides = defaultReviewOverrides()) {
  const ranked = catalog
    .map((link) => ({ ...link, score: scoreCandidateWithLearning(link, ownProduct, competitor.id, reviewOverrides, { preview: true }) - reviewPenalty(decision, link.url) }))
    .filter((link) => link.score >= 7)
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(process.env.CATALOG_CANDIDATE_LIMIT || 8));

  const validated = [];
  for (const candidate of ranked) {
    try {
      const product = await getParsedCompetitorProduct(candidate.url, parsedCache);
      const score = scoreCandidateWithLearning(product, ownProduct, competitor.id, reviewOverrides) - reviewPenalty(decision, product.url);
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
  if (["primary", "secondary"].some((license) => typeof product?.licenses?.[license]?.price === "number")) return true;
  return Object.values(product?.platformLicenses || {})
    .some((licenses) => ["primary", "secondary"].some((license) => typeof licenses?.[license]?.price === "number"));
}

function licensesForPlatform(product, platform) {
  const key = platformKey(platform);
  return product?.platformLicenses?.[key] || product?.licenses || {};
}

function buildReviewInsight(ownProduct, competitorId, match, result, overrides) {
  const decision = result?.decision || getReviewDecision(overrides, ownProduct.url, competitorId);
  if (decision?.confirmedUrl && match && normalizeReviewUrl(match.url) === normalizeReviewUrl(decision.confirmedUrl)) {
    return {
      status: "confirmed",
      confidence: 100,
      label: "Confirmado por você",
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
      reasons: [decision?.noTodayAt ? "Você marcou que não encontrou hoje" : "Nenhum candidato passou com segurança"]
    };
  }

  const score = scoreCandidateWithLearning(match, ownProduct, competitorId, overrides);
  const reasons = [];
  const ownPlatform = platformKey(ownProduct.platform || ownProduct.title || "");
  const candidateText = normalize(`${match.title || ""} ${match.description || ""} ${match.url || ""}`);
  const candidatePlatforms = platformsIn(candidateText);
  if (ownPlatform && candidateMatchesPlatform(candidatePlatforms, ownPlatform)) reasons.push("Plataforma bate");
  if (titleCoverageAccepted(gameTokens(ownProduct.title), new Set(gameTokens(match.title)))) reasons.push("Nome bate bem");
  if (hasAnyLicensePrice(match)) reasons.push("Preço de licença lido");
  if (imageLooksRelated(ownProduct.image, match.image)) reasons.push("Imagem parece relacionada");
  if (decision?.rejectedUrls?.[normalizeReviewUrl(match.url)]) reasons.push("Você já marcou este par como errado");
  const learningAdjustment = learnedCandidateAdjustment(ownProduct, match, competitorId, overrides);
  if (learningAdjustment >= 4) reasons.push("Padrao aprendido com suas correcoes");
  if (learningAdjustment <= -8) reasons.push("Penalizado por correcoes anteriores");

  const confidence = clamp(Math.round(score * 3.2 + (hasAnyLicensePrice(match) ? 8 : 0)), 1, 96);
  const status = confidence >= 82 ? "auto-high" : confidence >= 58 ? "auto-medium" : "needs-review";
  return {
    status,
    confidence,
    label: status === "auto-high" ? "IA: alta confianca" : status === "auto-medium" ? "IA: conferir" : "IA: revisar",
    source: result?.source || "auto",
    reasons: reasons.length ? reasons.slice(0, 4) : ["Comparação por nome e link"]
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
  const cacheKey = `competitor-catalog:${competitor.id}`;
  return cachedValue(cacheKey, CACHE_TTL.catalog, () => discoverCompetitorCatalogFresh(competitor));
}

async function discoverCompetitorCatalogFresh(competitor) {
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

async function getReviewCandidates({ ownUrl, competitorId, limit = 10, query = "" }) {
  const competitor = COMPETITORS.find((item) => item.id === competitorId);
  if (!competitor) throw new Error("Concorrente invalido");
  if (!ownUrl) throw new Error("Produto Nexus obrigatorio");

  const [ownProduct, overrides] = await Promise.all([
    getOwnProductForReview(ownUrl),
    getReviewOverrides().catch(() => defaultReviewOverrides())
  ]);
  const decision = getReviewDecision(overrides, ownProduct.url, competitor.id);
  const catalog = await discoverCompetitorCatalog(competitor);
  const manualQuery = cleanSearchQuery(query);
  const ownPlatform = platformKey(ownProduct.platform || ownProduct.title || "");
  const normalizedLimit = Math.max(Number(limit) || 10, 1);
  const catalogPool = manualQuery ? catalog.filter((link) => queryCandidateScore(link, manualQuery) > 0) : catalog;

  const searchLinks = new Map();
  if (manualQuery && catalogPool.length < Math.min(normalizedLimit, 6)) {
    for (const searchTerm of [manualQuery]) {
      try {
        const searchUrl = new URL("buscar", competitor.baseUrl);
        searchUrl.searchParams.set("q", searchTerm);
        const search = await fetchHtml(searchUrl.toString());
        for (const link of extractProductLinks(search.html, competitor.baseUrl)) searchLinks.set(link.url, link);
      } catch {
        // Search is only an assist for the review modal.
      }
    }
  }

  const ranked = uniqueBy([...searchLinks.values(), ...catalogPool], (item) => item.url)
    .filter((link) => !decision?.rejectedUrls?.[normalizeReviewUrl(link.url)])
    .map((link) => {
      const matchScore = scoreCandidateWithLearning(link, ownProduct, competitor.id, overrides, { preview: true }) - reviewPenalty(decision, link.url);
      const platformBoost = manualQuery && ownPlatform && candidateMatchesPlatform(platformsIn(`${link.text || ""} ${link.title || ""} ${link.url || ""}`), ownPlatform) ? 3 : 0;
      const searchScore = manualQuery ? queryCandidateScore(link, manualQuery) + platformBoost : 0;
      return { ...link, score: matchScore, searchScore };
    })
    .filter((link) => manualQuery ? link.searchScore > 0 : link.score >= 4)
    .sort((a, b) => (b.searchScore - a.searchScore) || (b.score - a.score))
    .slice(0, normalizedLimit);

  const candidates = (await mapLimit(ranked, 4, async (link) => {
    try {
      const product = await getParsedProductForReview(link.url);
      const score = scoreCandidateWithLearning(product, ownProduct, competitor.id, overrides) - reviewPenalty(decision, product.url);
      if (!manualQuery && score < 4) return null;
      return {
        url: product.url,
        title: product.title,
        image: product.image,
        platform: product.platform,
        licenses: licensesForPlatform(product, ownProduct.platform),
        score,
        review: buildReviewInsight(ownProduct, competitor.id, product, { source: "candidate", decision }, overrides)
      };
    } catch {
      return null;
    }
  })).filter(Boolean);

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

async function getOwnProductForReview(ownUrl) {
  const normalizedOwnUrl = normalizeReviewUrl(ownUrl);
  try {
    const report = await getSavedReport();
    const item = (report?.items || []).find((product) => normalizeReviewUrl(product.url) === normalizedOwnUrl);
    if (item) return normalizeManualItem(item);
  } catch {
    // Fall back to the live page if the saved report is unavailable.
  }
  const ownPage = await fetchProduct(ownUrl);
  return parseProductPage(ownPage.html, ownPage.url);
}

async function getParsedProductForReview(url) {
  return cachedValue(`parsed-review-product:${normalizeReviewUrl(url)}`, CACHE_TTL.parsedProduct, async () => {
    const page = await fetchProduct(url);
    return parseProductPage(page.html, page.url);
  });
}

async function cachedValue(key, ttlMs, loader) {
  const now = Date.now();
  const current = memoryCache.get(key);
  if (current?.value !== undefined && current.expiresAt > now) return current.value;
  if (current?.promise) return current.promise;

  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .catch((error) => {
      memoryCache.delete(key);
      throw error;
    });
  memoryCache.set(key, { promise, expiresAt: now + ttlMs });
  return promise;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function queryCandidateScore(link, query) {
  const queryTokens = gameTokens(query);
  if (!queryTokens.length) return 0;
  const haystack = comparableTokenSet(gameTokens(`${link.text || ""} ${link.title || ""} ${link.url || ""}`));
  return queryTokens.reduce((score, token) => score + (haystack.has(token) ? (token.length >= 4 ? 2 : 1) : 0), 0);
}

function scoreCandidateWithLearning(candidate, ownProduct, competitorId, reviewOverrides, options = {}) {
  const baseScore = scoreCandidate(candidate, ownProduct, options);
  if (!baseScore) return 0;
  return baseScore + learnedCandidateAdjustment(ownProduct, candidate, competitorId, reviewOverrides);
}

function learnedCandidateAdjustment(ownProduct, candidate, competitorId, reviewOverrides) {
  const examples = reviewOverrides?.learning?.examples;
  if (!Array.isArray(examples) || !examples.length) return 0;

  const ownTokens = coreTitleTokens(gameTokens(ownProduct.title || ""));
  const candidateTokens = coreTitleTokens(gameTokens(`${candidate.text || ""} ${candidate.title || ""} ${candidate.url || ""}`));
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  const ownFamily = reviewFamilyKey(ownProduct);
  const candidateFamily = reviewFamilyKey(candidate);
  let adjustment = 0;

  for (const example of examples.slice(-500)) {
    const sameCompetitor = example.competitorId === competitorId;
    const ownSimilarity = learnedTokenSimilarity(ownSet, new Set(example.ownTokens || []));
    const sameOwnFamily = example.ownFamilyKey && example.ownFamilyKey === ownFamily;
    if (sameCompetitor) {
      if (ownSimilarity < 0.65 && !sameOwnFamily) continue;
    } else if (!sameOwnFamily && ownSimilarity < 0.85) {
      continue;
    }
    const candidateSimilarity = learnedTokenSimilarity(candidateSet, new Set(example.candidateTokens || []));
    const sameCandidateFamily = example.candidateFamilyKey && example.candidateFamilyKey === candidateFamily;
    const sameCandidateUrl = normalizeReviewUrl(example.candidateUrl) === normalizeReviewUrl(candidate.url);
    const confidence = Math.max(candidateSimilarity, sameCandidateFamily ? 0.9 : 0, sameCandidateUrl ? 1 : 0);
    if (confidence < 0.65) continue;
    if (example.action === "positive") {
      adjustment += sameCandidateUrl ? 14 : Math.round((sameCompetitor ? 8 : 5) * confidence);
    }
    if (example.action === "negative") {
      adjustment -= sameCandidateUrl ? 30 : Math.round((sameCompetitor ? 16 : 10) * confidence);
    }
  }

  adjustment += learnedCorrectionContrastAdjustment({
    examples,
    ownFamily,
    ownSet,
    candidateSet,
    candidateFamily,
    candidateTokens
  });

  return clamp(adjustment, -30, 14);
}

function learnedCorrectionContrastAdjustment({ examples, ownFamily, ownSet, candidateSet, candidateFamily, candidateTokens }) {
  const relevant = examples.slice(-500).filter((example) => {
    if (example.ownFamilyKey === ownFamily) return true;
    return learnedTokenSimilarity(ownSet, new Set(example.ownTokens || [])) >= 0.85;
  });
  const positives = relevant.filter((example) => example.action === "positive");
  const negatives = relevant.filter((example) => example.action === "negative");
  if (!positives.length || !negatives.length) return 0;

  const positiveFamilies = new Set(positives.map((example) => example.candidateFamilyKey).filter(Boolean));
  const negativeFamilies = new Set(negatives.map((example) => example.candidateFamilyKey).filter(Boolean));
  const positiveExtraTokens = learnedExampleTokenSet(positives, "candidateExtraTokens");
  const negativeExtraTokens = learnedExampleTokenSet(negatives, "candidateExtraTokens");
  const positiveMissingTokens = learnedExampleTokenSet(positives, "ownMissingTokens");
  const negativeMissingTokens = learnedExampleTokenSet(negatives, "ownMissingTokens");

  let adjustment = 0;
  if (positiveFamilies.has(candidateFamily) && !negativeFamilies.has(candidateFamily)) adjustment += 4;
  if (negativeFamilies.has(candidateFamily) && !positiveFamilies.has(candidateFamily)) adjustment -= 12;

  const candidateExtraTokens = candidateTokens.filter((token) => !ownSet.has(token));
  const negativeOnlyExtras = candidateExtraTokens.filter((token) => negativeExtraTokens.has(token) && !positiveExtraTokens.has(token));
  adjustment -= Math.min(12, negativeOnlyExtras.length * 5);

  const candidateMissingOwnTokens = Array.from(ownSet).filter((token) => !candidateSet.has(token));
  const negativeOnlyMissing = candidateMissingOwnTokens.filter((token) => negativeMissingTokens.has(token) && !positiveMissingTokens.has(token));
  adjustment -= Math.min(8, negativeOnlyMissing.length * 4);

  return clamp(adjustment, -14, 5);
}

function learnedExampleTokenSet(examples, key) {
  const tokens = new Set();
  for (const example of examples) {
    for (const token of example?.[key] || []) {
      if (!LOOSE_TITLE_TOKENS.has(token)) tokens.add(token);
    }
  }
  return tokens;
}

function learnedTokenSimilarity(leftSet, rightSet) {
  if (!leftSet.size || !rightSet.size) return 0;
  let shared = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) shared += 1;
  }
  return shared / Math.max(leftSet.size, rightSet.size);
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
  const pageUnavailable = isUnavailableProductPage(html, text);
  const parsedVariants = normalizeParsedVariants(parseStructuredVariants(html) || parseVariants(text));
  const variants = applyPageAvailability(parsedVariants.licenses, pageUnavailable);
  const platformLicenses = applyPlatformPageAvailability(parsedVariants.platformLicenses, pageUnavailable);

  return {
    title,
    url,
    image,
    description,
    platform,
    licenses: variants,
    platformLicenses
  };
}

function normalizeParsedVariants(parsed) {
  if (!parsed?.licenses) return { licenses: parsed, platformLicenses: {} };
  return {
    licenses: parsed.licenses,
    platformLicenses: parsed.platformLicenses || {}
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
      available: true
    });
  });

  const licenses = { primary: { price: null }, secondary: { price: null } };
  const platformLicenses = {};
  let mapped = 0;
  for (const option of options) {
    if (isRental(option.name)) continue;
    const license = inferLicense(option.name);
    if (!license) continue;
    const payload = priceBlocks.get(option.id);
    if (!payload || typeof payload.price !== "number") continue;
    licenses[license].price = payload.price;
    licenses[license].available = payload.available;
    const optionPlatform = platformKey(inferPlatform(option.name));
    if (optionPlatform) {
      platformLicenses[optionPlatform] = platformLicenses[optionPlatform] || { primary: { price: null }, secondary: { price: null } };
      platformLicenses[optionPlatform][license].price = payload.price;
      platformLicenses[optionPlatform][license].available = payload.available;
    }
    mapped += 1;
  }

  return mapped ? { licenses, platformLicenses } : null;
}

function applyPageAvailability(licenses, pageUnavailable) {
  if (!licenses || !pageUnavailable) return licenses;
  for (const license of Object.values(licenses)) {
    if (typeof license.price === "number") license.available = false;
  }
  return licenses;
}

function applyPlatformPageAvailability(platformLicenses, pageUnavailable) {
  if (!platformLicenses || !pageUnavailable) return platformLicenses || {};
  for (const licenses of Object.values(platformLicenses)) {
    applyPageAvailability(licenses, pageUnavailable);
  }
  return platformLicenses;
}

function isUnavailableProductPage(html, lines = []) {
  const visibleLines = Array.isArray(lines) ? lines : String(lines || "").split(/\s*\n\s*/);
  const relevantText = visibleLines.slice(0, 140).join(" ");
  return isUnavailableText(relevantText) || hasStructuredOutOfStock(html);
}

function isUnavailableText(value) {
  return /produto encontra se indispon|produto encontra-se indispon|avise.*quando chegar|avisaremos quando chegar|sem estoque|esgotad[oa]/i.test(normalize(value));
}

function hasStructuredOutOfStock(html) {
  return /itemprop=["']availability["'][^>]+(?:outofstock|out-of-stock)|availability["']?\s*:\s*["'][^"']*(?:outofstock|out-of-stock)/i.test(String(html || ""));
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
  const ownPlatform = platformKey(ownProduct.platform || ownProduct.title || "");
  const candidatePlatforms = platformsIn(candidateText);
  if (ownPlatform && candidatePlatforms.size && !candidateMatchesPlatform(candidatePlatforms, ownPlatform)) return 0;

  const ownTokens = gameTokens(`${ownProduct.title || ""} ${ownProduct.description || ""}`);
  const candidateTokens = new Set(gameTokens(candidateText));
  const comparableCandidateTokens = comparableTokenSet(candidateTokens);
  const ownTitleTokens = gameTokens(ownProduct.title);
  const candidateTitleSource = cleanText(`${candidate.text || ""} ${candidate.title || ""}`) || candidate.url || "";
  const candidateTitlePlatforms = platformsIn(candidateTitleSource);
  if (ownPlatform && candidateTitlePlatforms.size && !candidateMatchesPlatform(candidateTitlePlatforms, ownPlatform)) return 0;
  const candidateTitleTokens = new Set(gameTokens(candidateTitleSource));
  const equivalentEdition = hasEquivalentEdition(ownTitleTokens, candidateTitleTokens);
  const equivalentTitle = hasEquivalentTitle(ownTitleTokens, candidateTitleTokens)
    || hasRawEquivalentTitle(ownProduct.title, candidateTitleSource);
  const evidence = productMatchEvidence(ownProduct, candidate, ownTitleTokens, candidateTitleTokens);
  const ownTitleNumbers = titleNumberTokens(ownTitleTokens);
  const candidateTitleNumbers = titleNumberTokens(Array.from(candidateTitleTokens));
  if (!equivalentTitle && Array.from(ownTitleNumbers).some((token) => !candidateTitleNumbers.has(token) && !candidateTokens.has(token))) return 0;
  if (!equivalentTitle && Array.from(candidateTitleNumbers).some((token) => !ownTitleNumbers.has(token))) return 0;
  if ((ownTokens.includes("fc") || ownTokens.includes("fifa")) && !(candidateTokens.has("fc") || candidateTokens.has("fifa"))) return 0;
  if (ownTokens.includes("gta") && ownTokens.includes("5") && candidateTokens.has("trilogy")) return 0;
  if (hasF1ManagerMismatch(ownTitleTokens, candidateTitleTokens)) return 0;
  if (hasNeedForSpeedSubtitleMismatch(ownTitleTokens, candidateTitleTokens)) return 0;
  if (hasDragonBallFighterzEditionMismatch(ownProduct.title, candidateTitleSource)) return 0;
  if (hasNarutoSubtitleMismatch(ownTitleTokens, candidateTitleTokens)) return 0;
  if (hasResidentEvilSubtitleMismatch(ownTitleTokens, candidateTitleTokens)) return 0;
  if (hasEldenRingSubtitleMismatch(ownTitleTokens, candidateTitleTokens)) return 0;
  if (hasCrashNitroEditionMismatch(ownTitleTokens, candidateTitleTokens)) return 0;
  if (hasAssassinsCreedSubtitleMismatch(ownTitleTokens, candidateTitleTokens)) return 0;
  if (hasOvercookedBundleMismatch(ownProduct.title, candidateTitleSource)) return 0;
  if (hasStandaloneDlcPrefix(candidateTitleSource, ownProduct.title)) return 0;
  if (hasDlcSubtitleMismatch(ownTitleTokens, candidateTitleTokens)) return 0;
  const titleCoverageOk = titleCoverageAccepted(ownTitleTokens, candidateTitleTokens) || evidence.supportsTitleCoverage;
  if (!equivalentEdition && !equivalentTitle && !titleCoverageOk) return 0;
  if (!coreTitleAgreementAccepted(ownTitleTokens, candidateTitleTokens) && !evidence.supportsCoreAgreement) return 0;
  if (!franchiseSubtitleCompatible(ownTitleTokens, candidateTitleTokens)) return 0;
  if (hasEditionMismatch(ownTitleTokens, candidateTitleTokens)) return 0;
  if (hasConflictingExtraEdition(ownTitleTokens, candidateTitleTokens)) return 0;

  let tokenScore = 0;
  let meaningfulMatches = 0;
  for (const token of ownTokens) {
    if (!hasComparableToken(token, comparableCandidateTokens)) continue;
    tokenScore += token.length >= 4 ? 2 : 1;
    if (!/^\d+$/.test(token)) meaningfulMatches += 1;
  }
  const minimumTokenScore = equivalentEdition ? 4 : equivalentTitle ? 2 : options.preview ? (ownTitleTokens.length <= 2 ? 2 : 3) : (ownTitleTokens.length <= 2 ? 2 : 6);
  if (!meaningfulMatches || tokenScore < minimumTokenScore) return 0;

  let score = tokenScore;
  score += titleCoverageScore(ownTitleTokens, candidateTitleTokens);
  if (equivalentTitle) score += 10;
  score += editionCompatibilityScore(ownTitleTokens, candidateTitleTokens);
  score += evidence.score;
  if (ownPlatform && candidatePlatforms.has(ownPlatform)) score += 5;
  if (imageLooksRelated(ownProduct.image, candidate.image)) score += 3;
  if (candidate.description && titleCoverageAccepted(ownTitleTokens, new Set(gameTokens(candidate.description)))) score += 2;
  return score;
}

function candidateMatchesPlatform(candidatePlatforms, ownPlatform) {
  if (!ownPlatform || !candidatePlatforms?.size) return true;
  if (candidatePlatforms.has(ownPlatform)) return true;
  if (ownPlatform === "xbox" && (candidatePlatforms.has("xbox one") || candidatePlatforms.has("xbox series"))) return true;
  if ((ownPlatform === "xbox one" || ownPlatform === "xbox series") && candidatePlatforms.has("xbox")) return true;
  return false;
}

function titleCoverageAccepted(ownTokens, candidateTokens) {
  return titleCoverageScore(ownTokens, candidateTokens) >= 8;
}

function coreTitleAgreementAccepted(ownTokens, candidateTokens) {
  const coreOwn = coreTitleTokens(ownTokens);
  if (!coreOwn.length) return true;
  const comparableCandidate = comparableTokenSet(candidateTokens);
  return coreOwn.some((token) => hasComparableToken(token, comparableCandidate));
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
  if (ownSet.has("minecraft") && candidateSet.has("minecraft")) {
    const ownSpinOff = MINECRAFT_SPINOFF_TOKENS.some((token) => ownSet.has(token));
    const candidateSpinOff = MINECRAFT_SPINOFF_TOKENS.some((token) => candidateSet.has(token));
    if (ownSpinOff !== candidateSpinOff) return false;
  }
  if (ownSet.has("call") && ownSet.has("duty") && candidateSet.has("call") && candidateSet.has("duty")) {
    const subtitle = ownTokens.filter((token) => !CALL_OF_DUTY_BASE_TOKENS.has(token) && !/^\d+$/.test(token));
    return subtitle.every((token) => hasComparableToken(token, candidateSet));
  }
  if (ownSet.has("dark") && ownSet.has("pictures") && ownSet.has("anthology")
    && candidateSet.has("dark") && candidateSet.has("pictures") && candidateSet.has("anthology")) {
    const candidateList = Array.from(candidateTokens);
    const ownSubtitle = ownTokens.filter((token) => !DARK_PICTURES_BASE_TOKENS.has(token) && !LOOSE_TITLE_TOKENS.has(token) && !/^\d+$/.test(ROMAN_NUMERALS[token] || token));
    const candidateSubtitle = candidateList.filter((token) => !DARK_PICTURES_BASE_TOKENS.has(token) && !LOOSE_TITLE_TOKENS.has(token) && !/^\d+$/.test(ROMAN_NUMERALS[token] || token));
    if (!ownSubtitle.length || !candidateSubtitle.length) return true;
    return ownSubtitle.every((token) => hasComparableToken(token, candidateSet));
  }
  return true;
}

function hasF1ManagerMismatch(ownTokens, candidateTokens) {
  const ownSet = new Set(ownTokens);
  const candidateSet = new Set(candidateTokens);
  if (!ownSet.has("f1") || !candidateSet.has("f1")) return false;
  return ownSet.has("manager") !== candidateSet.has("manager");
}

function hasNeedForSpeedSubtitleMismatch(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!(ownSet.has("need") && ownSet.has("speed") && candidateSet.has("need") && candidateSet.has("speed"))) return false;
  const subtitles = [
    ["heat"],
    ["unbound"],
    ["payback"],
    ["rivals"],
    ["hot", "pursuit"],
    ["most", "wanted"]
  ];
  return subtitles.some((group) => (
    group.every((token) => ownSet.has(token))
    && !group.every((token) => candidateSet.has(token))
  ));
}

function hasDragonBallFighterzEditionMismatch(ownTitle, candidateTitle) {
  const own = normalize(ownTitle);
  const candidate = normalize(candidateTitle);
  const sameGame = /\bdragon ball\b/.test(own)
    && /\bfighter\s*z\b|\bfighterz\b/.test(own)
    && /\bdragon ball\b/.test(candidate)
    && /\bfighter\s*z\b|\bfighterz\b/.test(candidate);
  if (!sameGame) return false;
  return !/\bedi(?:cao|o)\s+fighterz\b|\bfighterz edition\b/.test(own)
    && /\bedi(?:cao|o)\s+fighterz\b|\bfighterz edition\b/.test(candidate);
}

function hasNarutoSubtitleMismatch(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("naruto") || !candidateSet.has("naruto")) return false;
  const exclusiveGroups = [
    ["road", "boruto"],
    ["legacy"],
    ["trilogy"],
    ["connections"],
    ["shinobi", "striker"]
  ];
  return exclusiveGroups.some((group) => group.every((token) => candidateSet.has(token))
    && !group.every((token) => ownSet.has(token)));
}

function hasResidentEvilSubtitleMismatch(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("resident") || !ownSet.has("evil") || !candidateSet.has("resident") || !candidateSet.has("evil")) return false;
  const exclusiveGroups = [
    ["village"],
    ["triple", "pack"],
    ["revelations"],
    ["origins"]
  ];
  return exclusiveGroups.some((group) => group.every((token) => candidateSet.has(token))
    && !group.every((token) => ownSet.has(token)));
}

function hasEldenRingSubtitleMismatch(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("elden") || !ownSet.has("ring") || !candidateSet.has("elden") || !candidateSet.has("ring")) return false;
  return candidateSet.has("nightreign") && !ownSet.has("nightreign");
}

function hasCrashNitroEditionMismatch(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("crash") || !ownSet.has("nitro") || !candidateSet.has("crash") || !candidateSet.has("nitro")) return false;
  return (candidateSet.has("oxide") || candidateSet.has("nitros")) && !(ownSet.has("oxide") || ownSet.has("nitros"));
}

function hasAssassinsCreedSubtitleMismatch(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  const ownAssassin = ownSet.has("assassin") || ownSet.has("assassins");
  const candidateAssassin = candidateSet.has("assassin") || candidateSet.has("assassins");
  if (!ownAssassin || !candidateAssassin || !ownSet.has("creed") || !candidateSet.has("creed")) return false;
  const groups = [
    ["valhalla"],
    ["mirage"],
    ["origins"],
    ["odyssey"],
    ["syndicate"],
    ["unity"],
    ["black", "flag"],
    ["ezio"],
    ["3"],
    ["4"]
  ];
  const ownGroups = groups.filter((group) => group.every((token) => ownSet.has(token)));
  if (!ownGroups.length) return false;
  return groups.some((group) => group.every((token) => candidateSet.has(token))
    && !ownGroups.some((ownGroup) => ownGroup.length === group.length && ownGroup.every((token, index) => token === group[index])));
}

function hasOvercookedBundleMismatch(ownTitle, candidateTitle) {
  if (!isOvercookedBundleTitle(ownTitle)) return false;
  return !isOvercookedBundleTitle(candidateTitle);
}

function hasDlcSubtitleMismatch(ownTokens, candidateTokens) {
  if (hasEquivalentEdition(ownTokens, candidateTokens)) return false;
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (candidateSet.has("dlc") && !(ownSet.has("dlc") || ownSet.has("dlcs"))) return true;
  if (candidateSet.has("dlcs") && candidateSet.has("pacote") && !(ownSet.has("dlc") || ownSet.has("dlcs"))) return true;
  return DLC_SUBTITLE_TOKEN_GROUPS.some((group) => hasDlcSubtitleGroup(ownSet, group) !== hasDlcSubtitleGroup(candidateSet, group));
}

function hasStandaloneDlcPrefix(candidateTitle, ownTitle) {
  const candidate = normalize(candidateTitle);
  const own = normalize(ownTitle);
  if (/^dlcs?\b/.test(candidate) && !/^dlcs?\b/.test(own)) return true;
  return false;
}

function hasDlcSubtitleGroup(tokens, group) {
  return group.every((alternatives) => alternatives.some((token) => tokens.has(token)));
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
  const matches = distinctOwn.filter((token) => hasComparableToken(token, comparableCandidate));
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

function hasComparableToken(token, comparableTokens) {
  const normalized = ROMAN_NUMERALS[token] || token;
  if (comparableTokens.has(token) || comparableTokens.has(normalized)) return true;
  if (!isFuzzyTitleTokenEligible(token)) return false;
  return Array.from(comparableTokens).some((candidate) => areCompressedTitleVariants(token, candidate));
}

function areCompressedTitleVariants(left, right) {
  if (left === right || !isFuzzyTitleTokenEligible(left) || !isFuzzyTitleTokenEligible(right)) return false;
  const [longer, shorter] = left.length >= right.length ? [left, right] : [right, left];
  const diff = longer.length - shorter.length;
  if (diff < 1 || diff > 2 || shorter.length < 3 || longer.length > 10) return false;
  if (longer[0] !== shorter[0]) return false;

  const removed = removedSubsequenceChars(longer, shorter);
  return removed.length === diff && removed.every((char) => VOWELS.has(char));
}

function removedSubsequenceChars(longer, shorter) {
  const removed = [];
  let shorterIndex = 0;
  for (const char of longer) {
    if (shorterIndex < shorter.length && char === shorter[shorterIndex]) {
      shorterIndex += 1;
    } else {
      removed.push(char);
    }
  }
  return shorterIndex === shorter.length ? removed : [];
}

function isFuzzyTitleTokenEligible(token) {
  return /^[a-z]+$/.test(token)
    && token.length >= 3
    && token.length <= 10
    && !LOOSE_TITLE_TOKENS.has(token)
    && !EDITION_TOKENS.has(token)
    && !STOP_WORDS.has(token);
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
  if (hasEquivalentEdition(ownTokens, candidateTokens) || hasEquivalentTitle(ownTokens, candidateTokens)) return 5;
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

function hasEditionMismatch(ownTokens, candidateTokens) {
  if (hasEquivalentEdition(ownTokens, candidateTokens) || hasEquivalentTitle(ownTokens, candidateTokens)) return false;
  const ownSet = new Set(ownTokens);
  const candidateSet = new Set(candidateTokens);
  const ownEditions = Array.from(ownSet).filter((token) => STRICT_VERSION_TOKENS.has(token));
  const candidateEditions = Array.from(candidateSet).filter((token) => STRICT_VERSION_TOKENS.has(token));
  const missingInCandidate = ownEditions.some((token) => !candidateSet.has(token));
  const extraInCandidate = candidateEditions.some((token) => !ownSet.has(token));
  return missingInCandidate || extraInCandidate;
}

function hasConflictingExtraEdition(ownTokens, candidateTokens) {
  if (hasEquivalentEdition(ownTokens, candidateTokens) || hasEquivalentTitle(ownTokens, candidateTokens)) return false;
  const ownSet = new Set(ownTokens);
  return Array.from(candidateTokens)
    .some((token) => STRONG_EXTRA_EDITION_TOKENS.has(token) && !ownSet.has(token));
}

function hasEquivalentEdition(ownTokens, candidateTokens) {
  return isCyberpunkUltimateEquivalent(ownTokens, candidateTokens)
    || isNarutoUltimateNinjaStormEquivalent(ownTokens, candidateTokens)
    || isUltimateBundleEquivalent(ownTokens, candidateTokens);
}

function hasEquivalentTitle(ownTokens, candidateTokens) {
  return isGodOfWar2018Equivalent(ownTokens, candidateTokens)
    || isLastOfUsRemasteredEquivalent(ownTokens, candidateTokens)
    || isResidentEvil4GoldRemakeEquivalent(ownTokens, candidateTokens)
    || isResidentEvil4RemakeEquivalent(ownTokens, candidateTokens)
    || isResidentEvilVillageEquivalent(ownTokens, candidateTokens)
    || isGhostTsushimaDirectorEquivalent(ownTokens, candidateTokens)
    || isResidentEvilTriplePackEquivalent(ownTokens, candidateTokens)
    || isCrashBandicoot4Equivalent(ownTokens, candidateTokens);
}

function hasRawEquivalentTitle(ownTitle, candidateTitle) {
  return isOvercookedBundleEquivalent(ownTitle, candidateTitle);
}

function isOvercookedBundleEquivalent(ownTitle, candidateTitle) {
  return isOvercookedBundleTitle(ownTitle) && isOvercookedBundleTitle(candidateTitle);
}

function isOvercookedBundleTitle(title) {
  const raw = String(title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const normalized = normalize(title);
  if (!/\bovercooked\b/.test(normalized)) return false;
  return /\bovercooked\b[\s!._:-]*[+&][\s!._:-]*\bovercooked\b.*\b2\b/.test(raw)
    || /\bovercooked\b.*\b1\b.*\b2\b/.test(normalized);
}

function isGodOfWar2018Equivalent(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("god") || !ownSet.has("war") || !ownSet.has("4")) return false;
  if (!candidateSet.has("god") || !candidateSet.has("war")) return false;
  return !["ragnarok", "3", "ascension"].some((token) => candidateSet.has(token));
}

function isLastOfUsRemasteredEquivalent(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("last") || !ownSet.has("us") || !ownSet.has("remastered")) return false;
  if (!candidateSet.has("last") || !candidateSet.has("us") || !candidateSet.has("remastered")) return false;
  return !candidateSet.has("2");
}

function isResidentEvil4RemakeEquivalent(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("resident") || !ownSet.has("evil") || !ownSet.has("4")) return false;
  if (!candidateSet.has("resident") || !candidateSet.has("evil") || !candidateSet.has("4")) return false;
  if (ownSet.has("2005") || candidateSet.has("2005")) return false;
  const blockedEditions = ["gold", "ultimate", "deluxe", "complete", "collection", "colecao", "trilogy", "bundle", "pack", "triple", "village", "revelations", "origins"];
  if (blockedEditions.some((token) => ownSet.has(token) || candidateSet.has(token))) return false;
  return ownSet.has("remake") || candidateSet.has("remake");
}

function isResidentEvil4GoldRemakeEquivalent(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("resident") || !ownSet.has("evil") || !ownSet.has("4") || !ownSet.has("gold")) return false;
  if (!candidateSet.has("resident") || !candidateSet.has("evil") || !candidateSet.has("4") || !candidateSet.has("gold")) return false;
  if (ownSet.has("2005") || candidateSet.has("2005")) return false;
  return ownSet.has("remake") || candidateSet.has("remake");
}

function isResidentEvilVillageEquivalent(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  return ownSet.has("resident")
    && ownSet.has("evil")
    && ownSet.has("village")
    && candidateSet.has("resident")
    && candidateSet.has("evil")
    && candidateSet.has("village");
}

function isGhostTsushimaDirectorEquivalent(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("ghost") || !ownSet.has("tsushima") || !candidateSet.has("ghost") || !candidateSet.has("tsushima")) return false;
  const ownDirector = ownSet.has("diretor") || (ownSet.has("versao") && ownSet.has("diretor")) || (ownSet.has("director") && ownSet.has("cut"));
  const candidateDirector = (candidateSet.has("versao") && candidateSet.has("diretor")) || (candidateSet.has("director") && candidateSet.has("cut")) || (candidateSet.has("directors") && candidateSet.has("cut"));
  return ownDirector && candidateDirector;
}

function isResidentEvilTriplePackEquivalent(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  return ownSet.has("resident")
    && ownSet.has("evil")
    && ownSet.has("triple")
    && ownSet.has("pack")
    && candidateSet.has("resident")
    && candidateSet.has("evil")
    && candidateSet.has("triple")
    && candidateSet.has("pack");
}

function isCrashBandicoot4Equivalent(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("crash") || !ownSet.has("bandicoot") || !ownSet.has("4")) return false;
  if (!candidateSet.has("crash") || !candidateSet.has("bandicoot") || !candidateSet.has("4")) return false;
  return !["trilogy", "nitro", "racing"].some((token) => ownSet.has(token) || candidateSet.has(token));
}

function isCyberpunkUltimateEquivalent(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("cyberpunk") || !ownSet.has("2077") || !candidateSet.has("cyberpunk") || !candidateSet.has("2077")) return false;
  const ownUltimate = ownSet.has("ultimate");
  const candidateUltimate = candidateSet.has("ultimate");
  const ownPhantomBundle = ownSet.has("phantom") && ownSet.has("liberty") && (ownSet.has("bundle") || ownSet.has("pacote"));
  const candidatePhantomBundle = candidateSet.has("phantom") && candidateSet.has("liberty") && (candidateSet.has("bundle") || candidateSet.has("pacote"));
  return (ownUltimate && candidatePhantomBundle) || (candidateUltimate && ownPhantomBundle);
}

function isNarutoUltimateNinjaStormEquivalent(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("naruto") || !ownSet.has("storm") || !candidateSet.has("naruto") || !candidateSet.has("storm")) return false;
  if (!candidateSet.has("ultimate") || !candidateSet.has("ninja")) return false;
  const ownNumbers = titleNumberTokens(ownTokens);
  const candidateNumbers = titleNumberTokens(Array.from(candidateTokens));
  if (Array.from(ownNumbers).some((token) => !candidateNumbers.has(token))) return false;
  return !Array.from(candidateNumbers).some((token) => !ownNumbers.has(token));
}

function isUltimateBundleEquivalent(ownTokens, candidateTokens) {
  const ownSet = comparableTokenSet(ownTokens);
  const candidateSet = comparableTokenSet(candidateTokens);
  if (!ownSet.has("ultimate") || !candidateSet.has("ultimate")) return false;
  if (!(candidateSet.has("bundle") || candidateSet.has("pacote"))) return false;
  if ((candidateSet.has("dlc") || candidateSet.has("dlcs")) && !candidateSet.has("jogo")) return false;
  const extraEditions = Array.from(candidateSet)
    .filter((token) => STRICT_VERSION_TOKENS.has(token) && !ownSet.has(token))
    .filter((token) => !["bundle", "pacote", "pack"].includes(token));
  return extraEditions.length === 0;
}

function imageLooksRelated(ownImage, candidateImage) {
  if (!ownImage || !candidateImage) return false;
  const own = imageKey(ownImage);
  const candidate = imageKey(candidateImage);
  if (!own || !candidate) return false;
  return own === candidate || own.split("-").some((part) => part.length >= 6 && candidate.includes(part));
}

function productMatchEvidence(ownProduct, candidate, ownTitleTokens, candidateTitleTokens) {
  const candidateDescriptionTokens = gameTokens(candidate.description || "");
  const ownDescriptionTokens = gameTokens(ownProduct.description || "");
  const candidateImageTokens = imageEvidenceTokens(candidate.image);
  const ownImageTokens = imageEvidenceTokens(ownProduct.image);

  const candidateDescription = evidenceCoverage(ownTitleTokens, candidateDescriptionTokens);
  const ownDescription = evidenceCoverage(Array.from(candidateTitleTokens), ownDescriptionTokens);
  const candidateImage = evidenceCoverage(ownTitleTokens, candidateImageTokens);
  const ownImage = evidenceCoverage(Array.from(candidateTitleTokens), ownImageTokens);
  const imageRelated = imageLooksRelated(ownProduct.image, candidate.image);
  const imageScore = Math.max(candidateImage.score, ownImage.score, imageRelated ? 4 : 0);
  const descriptionScore = Math.max(candidateDescription.score, ownDescription.score);
  const score = Math.min(descriptionScore + imageScore, 8);
  const titleCoverage = titleCoverageScore(ownTitleTokens, candidateTitleTokens);
  const titleAnchor = distinctiveEvidenceTokens(ownTitleTokens)
    .some((token) => hasComparableToken(token, comparableTokenSet(candidateTitleTokens)));

  return {
    score,
    supportsTitleCoverage: (titleCoverage >= 5 && score >= 3)
      || (titleCoverage >= 4 && descriptionScore >= 3 && imageScore >= 3)
      || (titleAnchor && descriptionScore >= 3 && imageScore >= 3),
    supportsCoreAgreement: score >= 6
      && (candidateDescription.matches >= 2 || ownDescription.matches >= 2 || candidateImage.matches >= 2 || ownImage.matches >= 2)
  };
}

function evidenceCoverage(sourceTokens, targetTokens) {
  const source = distinctiveEvidenceTokens(sourceTokens);
  if (!source.length || !targetTokens?.length) return { score: 0, matches: 0 };
  const target = comparableTokenSet(targetTokens);
  const matches = source.filter((token) => hasComparableToken(token, target));
  if (!matches.length) return { score: 0, matches: 0 };
  const ratio = matches.length / source.length;
  const weighted = matches.reduce((total, token) => total + (token.length >= 5 ? 2 : 1), 0);
  const score = matches.length >= 2 && ratio >= 0.45 ? Math.min(weighted, 5) : 0;
  return { score, matches: matches.length };
}

function distinctiveEvidenceTokens(tokens) {
  return uniqueBy(tokens, (token) => token)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !LOOSE_TITLE_TOKENS.has(token))
    .filter((token) => !EDITION_TOKENS.has(token))
    .filter((token) => token.length >= 3 || /^\d{1,4}$/.test(ROMAN_NUMERALS[token] || token))
    .filter((token) => !/^\d{5,}$/.test(token));
}

function imageEvidenceTokens(value) {
  const key = imageKey(value);
  if (!key) return [];
  return gameTokens(key.replace(/\.(jpg|jpeg|png|webp|gif)$/i, " "));
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
  return normalize(normalizePlatformTokenSpacing(value)).split(/\s+/).filter(Boolean);
}

function normalizePlatformTokenSpacing(value) {
  return String(value || "")
    .replace(/\bplaystation\s*([345])\b/gi, "ps$1")
    .replace(/\bps\s*([345])\b/gi, "ps$1");
}

function gameTokens(value) {
  return expandAliases(tokenize(value).map(normalizeCommonTitleTypo))
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => token.length >= 2 || /^\d+$/.test(token));
}

function normalizeCommonTitleTypo(token) {
  if (token === "camping") return "campaign";
  if (token === "knigth") return "knight";
  if (token.endsWith("tm") && token.length > 3) return token.slice(0, -2);
  return token;
}

function expandAliases(tokens) {
  const expanded = [...tokens];
  const joined = tokens.join(" ");
  if (tokens.includes("gta") && (tokens.includes("5") || tokens.includes("v"))) expanded.push("grand", "theft", "auto", "5");
  if (/grand theft auto/.test(joined)) expanded.push("gta");
  if (/grand theft auto/.test(joined) && (tokens.includes("v") || tokens.includes("5"))) expanded.push("5");
  if (tokens.includes("fifa") || tokens.includes("fc")) expanded.push("fifa", "fc");
  if (tokens.includes("assassin") || tokens.includes("assassins")) expanded.push("assassin", "assassins");
  if (/dragon ball fighter\s*z/.test(joined) || /dragon ball fighterz/.test(joined)) expanded.push("fighterz");
  if (tokens.includes("colection")) expanded.push("collection");
  if (tokens.includes("yotei") || tokens.includes("ytei") || tokens.includes("yte") || tokens.includes("yote")) expanded.push("yotei", "ytei", "yte", "yote");
  return uniqueBy(expanded, (token) => token);
}

function platformsIn(value) {
  const text = normalize(normalizePlatformTokenSpacing(value));
  const platforms = new Set();
  if (/\bps5\b|playstation 5/.test(text)) platforms.add("ps5");
  if (/\bps4\b|playstation 4/.test(text)) platforms.add("ps4");
  if (/\bps3\b|playstation 3/.test(text)) platforms.add("ps3");
  if (/xbox series/.test(text)) platforms.add("xbox series");
  if (/xbox one/.test(text)) platforms.add("xbox one");
  if (/switch/.test(text)) platforms.add("switch");
  return platforms;
}

function platformKey(value) {
  const text = normalize(normalizePlatformTokenSpacing(value));
  if (/\bps5\b|playstation 5/.test(text)) return "ps5";
  if (/\bps4\b|playstation 4/.test(text)) return "ps4";
  if (/\bps3\b|playstation 3/.test(text)) return "ps3";
  if (/xbox series/.test(text)) return "xbox series";
  if (/xbox one/.test(text)) return "xbox one";
  if (/switch/.test(text)) return "switch";
  return "";
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
  "dia",
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
  "psn",
  "portugues",
  "ingles"
]);

const REVIEW_FAMILY_IGNORED_TOKENS = new Set([
  "ps4",
  "ps5",
  "ps3",
  "playstation",
  "midia",
  "dia",
  "digital",
  "primaria",
  "primario",
  "primary",
  "secundaria",
  "secundario",
  "secondary",
  "licenca",
  "jogo",
  "game",
  "games"
]);

const LOOSE_TITLE_TOKENS = new Set([
  "remaster",
  "remastered",
  "edition",
  "edicao",
  "standard",
  "midia",
  "dia",
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
  "definitiva",
  "definitivo",
  "remake",
  "remaster",
  "remastered",
  "champions",
  "premium",
  "standard",
  "anthology",
  "pacote",
  "pack",
  "duo",
  "duplo",
  "double"
]);

const CALL_OF_DUTY_BASE_TOKENS = new Set(["call", "duty", "cod"]);
const DARK_PICTURES_BASE_TOKENS = new Set(["dark", "pictures", "anthology"]);
const MINECRAFT_SPINOFF_TOKENS = ["dungeons", "legends"];

const DLC_SUBTITLE_TOKEN_GROUPS = [
  [["phantom"], ["liberty"]],
  [["burning"], ["shores"]],
  [["shadow", "shadows"], ["erdtree"]],
  [["vessel"], ["hatred"]],
  [["caminhos", "separate"], ["distintos", "ways"]]
];

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
  "definitiva",
  "definitivo",
  "remake",
  "remaster",
  "remastered",
  "champions",
  "premium",
  "anthology",
  "pacote",
  "pack",
  "duo",
  "duplo",
  "double"
]);

const STRICT_VERSION_TOKENS = new Set([
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
  "definitiva",
  "definitivo",
  "remake",
  "remaster",
  "remastered",
  "champions",
  "premium",
  "anthology",
  "pacote",
  "pack",
  "duo",
  "duplo",
  "double"
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

const VOWELS = new Set(["a", "e", "i", "o", "u"]);

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
module.exports.setRefreshControl = setRefreshControl;
module.exports.getRefreshControl = getRefreshControl;
module.exports.COMPETITORS = COMPETITORS;

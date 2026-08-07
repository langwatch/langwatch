import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_DIR = path.join(__dirname, "..");
const API_REF_DIR = path.join(DOCS_DIR, "api-reference");
const SPEC_PATH = path.join(API_REF_DIR, "openapiLangWatch.json");
const DOCS_JSON_PATH = path.join(DOCS_DIR, "docs.json");

interface OpenAPIOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
}

interface OpenAPISpec {
  paths: Record<string, Record<string, OpenAPIOperation>>;
}

interface EndpointGroup {
  name: string;
  dirName: string;
  pathPrefixes: string[];
  overviewDescription: string;
  /**
   * `METHOD /path` keys, in the order a reader should meet them.
   *
   * The default sort is CRUD-shaped — list, create, get, update, delete — which
   * is right for a resource but wrong for a family that is a sequence of steps.
   * A group whose overview describes a lifecycle sets this so the sidebar and
   * the prose agree; anything the list omits falls in behind, still sorted the
   * default way.
   */
  endpointOrder?: string[];
}

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Reasons per family, shared by the paths that belong to the same surface.
 * A reason states which kind of exclusion this is: a retired surface that is
 * intentionally undocumented, or a live surface that is not yet documented in
 * the API reference.
 */
const RETIRED_GATEWAY_PROVIDER_BINDINGS =
  "Retired surface, intentionally undocumented: the gateway provider binding routes answer 410 Gone, and the credentials they wrapped are managed under /api/model-providers.";

const UNDOCUMENTED_INGESTION_TEMPLATES =
  "Not yet documented in the API reference: the governance ingestion template routes have no reference pages yet.";

const UNDOCUMENTED_CALLER_IDENTITY =
  "Not yet documented in the API reference: the calling key's own project and usage routes have no reference pages yet.";

const UNDOCUMENTED_MODEL_DEFAULTS =
  "Not yet documented in the API reference: the default-model cascade routes have no reference pages yet.";

const UNDOCUMENTED_GOVERNED_ANALYTICS_SQL =
  "Not yet documented in the API reference: the governed analytics SQL routes ship behind the release_governed_sql_workbench flag and have no reference pages yet.";

/**
 * Spec paths that deliberately get no reference page, each with the reason it
 * is excluded. Every other spec path has to be owned by an ENDPOINT_GROUPS
 * entry, and the generator fails when one is owned by neither.
 */
const SKIP_PATHS: Record<string, string> = {
  "/": "Not an API route: the prompts app serves the spec's root path, so there is nothing to document.",
  "/api/trace/search":
    "Retired surface, intentionally undocumented: superseded by /api/traces/search.",
  "/api/trace/{id}":
    "Retired surface, intentionally undocumented: superseded by /api/traces/{traceId}.",
  "/api/gateway/v1/providers": RETIRED_GATEWAY_PROVIDER_BINDINGS,
  "/api/gateway/v1/providers/{id}": RETIRED_GATEWAY_PROVIDER_BINDINGS,
  "/api/governance/ingestion-templates": UNDOCUMENTED_INGESTION_TEMPLATES,
  "/api/governance/ingestion-templates/admin": UNDOCUMENTED_INGESTION_TEMPLATES,
  "/api/governance/ingestion-templates/clone": UNDOCUMENTED_INGESTION_TEMPLATES,
  "/api/governance/ingestion-templates/{id}": UNDOCUMENTED_INGESTION_TEMPLATES,
  "/api/governance/ingestion-templates/{id}/ottl-rules":
    UNDOCUMENTED_INGESTION_TEMPLATES,
  "/api/me/project": UNDOCUMENTED_CALLER_IDENTITY,
  "/api/me/usage": UNDOCUMENTED_CALLER_IDENTITY,
  "/api/model-defaults": UNDOCUMENTED_MODEL_DEFAULTS,
  "/api/model-defaults/{id}": UNDOCUMENTED_MODEL_DEFAULTS,
  "/api/v1/projects/{projectId}/analytics/query/clickhouse":
    UNDOCUMENTED_GOVERNED_ANALYTICS_SQL,
  "/api/v1/projects/{projectId}/analytics/schema":
    UNDOCUMENTED_GOVERNED_ANALYTICS_SQL,
  "/api/v1/projects/{projectId}/analytics/charts":
    UNDOCUMENTED_GOVERNED_ANALYTICS_SQL,
  "/api/v1/projects/{projectId}/analytics/charts/{chartId}":
    UNDOCUMENTED_GOVERNED_ANALYTICS_SQL,
};

const ENDPOINT_GROUPS: EndpointGroup[] = [
  {
    name: "Traces",
    dirName: "traces",
    pathPrefixes: ["/api/traces", "/api/trace"],
    overviewDescription:
      "Search, retrieve, and share LangWatch traces via the REST API. Traces capture the full execution of your LLM pipelines including all spans, evaluations, and metadata.",
  },
  {
    name: "Datasets",
    dirName: "datasets",
    pathPrefixes: ["/api/dataset"],
    overviewDescription:
      "Manage datasets for evaluations, experiments, and fine-tuning. Create, update, upload, and manage records programmatically.",
  },
  {
    name: "Evaluators",
    dirName: "evaluators-config",
    pathPrefixes: ["/api/evaluators"],
    overviewDescription:
      "Manage evaluator configurations for your project. Create, update, and organize evaluators used for online evaluations, guardrails, and experiments.",
  },
  {
    name: "Evaluations",
    dirName: "evaluations",
    // The guardrail path is the same call in gating mode, so it reads with the
    // evaluate endpoints rather than in a section of its own.
    pathPrefixes: ["/api/evaluations", "/api/guardrails"],
    overviewDescription:
      "Run an evaluator over a single input and get its score back, or run it as a guardrail and gate on one boolean. List the built-in evaluators to see which ids you can address and what each one needs.",
    endpointOrder: [
      "GET /api/evaluations/list",
      "POST /api/evaluations/{evaluator}/evaluate",
      "POST /api/evaluations/{evaluator}/{subpath}/evaluate",
      "POST /api/guardrails/{evaluator}/evaluate",
    ],
  },
  {
    name: "Experiments",
    dirName: "experiments",
    // Two prefixes, because the create endpoint is singular: `/api/experiments`
    // does not start with `/api/experiment/`, so one prefix would leave either
    // the create call or the rest of the family unowned.
    pathPrefixes: ["/api/experiments", "/api/experiment", "/api/dspy"],
    overviewDescription:
      "Create experiments, run them, and read their results over HTTP. Create an experiment against a slug you choose, start a run, then poll it and pull the per-row results. This is the same surface the SDKs use, so anything they do you can do directly.",
    // The order the overview describes, so a reader going down the sidebar
    // meets the calls in the order they would make them.
    endpointOrder: [
      "POST /api/experiment/init",
      "GET /api/experiments",
      "POST /api/experiments/{slug}/run",
      "GET /api/experiments/runs",
      "GET /api/experiments/runs/{runId}",
      "GET /api/experiments/runs/{runId}/results",
      "POST /api/dspy/log_steps",
    ],
  },
  {
    name: "Monitors",
    dirName: "monitors",
    pathPrefixes: ["/api/monitors"],
    overviewDescription:
      "Manage online evaluation monitors that automatically evaluate traces as they arrive. Create, update, enable/disable, and delete monitors.",
  },
  {
    name: "Prompts",
    dirName: "prompts",
    pathPrefixes: ["/api/prompts"],
    overviewDescription:
      "Manage prompt templates, versions, and tags. The Prompts API supports version control, tagging for deployment stages, and syncing with local files.",
  },
  {
    name: "Annotations",
    dirName: "annotations",
    pathPrefixes: ["/api/annotations"],
    overviewDescription:
      "Create and manage human annotations on traces for quality review, labeling, and evaluation.",
  },
  {
    name: "Scenarios",
    dirName: "scenarios",
    pathPrefixes: ["/api/scenarios"],
    overviewDescription:
      "Manage test scenarios for agent simulations. Create, update, and organize scenarios that define test cases for your AI agents.",
  },
  {
    name: "Scenario Events",
    dirName: "scenario-events",
    pathPrefixes: ["/api/scenario-events"],
    overviewDescription: "Create and manage scenario execution events.",
  },
  {
    name: "Simulation Runs",
    dirName: "simulation-runs",
    pathPrefixes: ["/api/simulation-runs"],
    overviewDescription:
      "Query simulation run results. List runs, get batch summaries, and retrieve individual run details.",
  },
  {
    name: "Suites",
    dirName: "suites",
    pathPrefixes: ["/api/suites"],
    overviewDescription:
      "Manage test suites (run plans) that group scenarios for batch execution. Create, update, duplicate, and trigger suite runs.",
  },
  {
    name: "Agents",
    dirName: "agents",
    pathPrefixes: ["/api/agents"],
    overviewDescription:
      "Manage AI agent configurations. Create, update, and organize agents that are tracked and evaluated in LangWatch.",
  },
  {
    name: "Triggers",
    dirName: "triggers",
    pathPrefixes: ["/api/triggers", "/api/trigger"],
    overviewDescription:
      "Manage automation triggers that fire actions based on trace events. Create Slack notifications, webhooks, and other automated responses.",
  },
  {
    name: "Events",
    dirName: "events",
    // `/api/track_event` is the older spelling of the same call, still the one
    // most SDK versions in the wild send.
    pathPrefixes: ["/api/events", "/api/track_event"],
    overviewDescription:
      "Record customer events against a trace or thread, so behaviour like a thumbs-up, a conversion or a refund sits alongside the trace that produced it.",
    endpointOrder: ["POST /api/events/track", "POST /api/track_event"],
  },
  {
    name: "Workflows",
    dirName: "workflows",
    // `/api/optimization/...` is the older spelling of the version-pinned
    // workflow run, and reads as part of the same family.
    pathPrefixes: ["/api/workflows", "/api/optimization"],
    overviewDescription:
      "Manage Optimization Studio workflows. List, update, and archive workflows used for prompt optimization and agent design.",
  },
  {
    name: "Dashboards",
    dirName: "dashboards",
    pathPrefixes: ["/api/dashboards"],
    overviewDescription:
      "Manage custom analytics dashboards. Create, reorder, and organize dashboards with custom graphs.",
  },
  {
    name: "Graphs",
    dirName: "graphs",
    pathPrefixes: ["/api/graphs"],
    overviewDescription:
      "Manage custom analytics graphs within dashboards. Create, update, and configure graph visualizations.",
  },
  {
    name: "Analytics",
    dirName: "analytics",
    pathPrefixes: ["/api/analytics"],
    overviewDescription:
      "Query analytics timeseries data with metrics, aggregations, and filters.",
  },
  {
    name: "Secrets",
    dirName: "secrets",
    pathPrefixes: ["/api/secrets"],
    overviewDescription:
      "Manage project secrets used for external integrations. Values are encrypted at rest and never returned in API responses.",
  },
  {
    name: "Model Providers",
    dirName: "model-providers",
    pathPrefixes: ["/api/model-providers"],
    overviewDescription:
      "Manage model provider configurations (API keys for OpenAI, Anthropic, etc.) used across the platform.",
  },
  {
    name: "Projects",
    dirName: "projects",
    pathPrefixes: ["/api/projects"],
    overviewDescription:
      "Manage LangWatch projects. Projects are the top-level containers for traces, evaluators, datasets, and other resources.",
  },
  {
    name: "Teams",
    dirName: "teams",
    pathPrefixes: ["/api/teams"],
    overviewDescription:
      "Manage teams within your organization. Teams group members and control access to projects.",
  },
  {
    name: "Groups",
    dirName: "groups",
    pathPrefixes: ["/api/groups"],
    overviewDescription:
      "Manage groups: named sets of members that carry role bindings and can hold a per-member spend allowance.",
  },
  {
    name: "API Keys",
    dirName: "api-keys",
    pathPrefixes: ["/api/api-keys"],
    overviewDescription:
      "Manage API keys for authenticating with the LangWatch API. Create service keys, personal keys, and manage their lifecycle.",
  },
  {
    name: "Gateway: Virtual Keys",
    dirName: "gateway-virtual-keys",
    pathPrefixes: ["/api/gateway/v1/virtual-keys"],
    overviewDescription:
      "Manage virtual keys for the AI Gateway. Virtual keys abstract provider credentials and enable usage tracking, rate limiting, and access control.",
  },
  {
    name: "Gateway: Budgets",
    dirName: "gateway-budgets",
    pathPrefixes: ["/api/gateway/v1/budgets"],
    overviewDescription:
      "Manage spending budgets for the AI Gateway. Set cost limits per project, team, or virtual key with configurable time windows.",
  },
  {
    name: "Gateway: Cache Rules",
    dirName: "gateway-cache-rules",
    pathPrefixes: ["/api/gateway/v1/cache-rules"],
    overviewDescription:
      "Manage cache-control rules for the AI Gateway. Configure semantic caching to reduce latency and costs for repeated queries.",
  },
  {
    name: "Gateway: Spend",
    dirName: "gateway-spend",
    pathPrefixes: [
      "/api/gateway/v1/spend-events",
      "/api/gateway/v1/spend-summaries",
      "/api/gateway/v1/end-users",
    ],
    overviewDescription:
      "Pull the per-request spend record for billing reconciliation: cursor-paged spend events, aggregate checksums, per-end-user rollups, and replay to a webhook endpoint.",
  },
  {
    name: "Webhooks",
    dirName: "webhooks",
    pathPrefixes: ["/api/webhooks/v1"],
    overviewDescription:
      "Register endpoints that receive signed, retried batches of LangWatch events, and inspect their delivery log, health, and the events the organization emitted.",
  },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function generateTitle(
  method: string,
  apiPath: string,
  op: OpenAPIOperation
): string {
  if (op.summary) return op.summary;

  const desc = op.description ?? "";
  if (desc) {
    const firstSentence = desc.split(/[.()]/)![0]!.trim();
    if (firstSentence.length <= 50) return firstSentence;
  }

  const resource = getResourceName(apiPath);
  const methodNames: Record<string, string> = {
    get: apiPath.includes("{") ? "Get" : "List",
    post: "Create",
    put: "Update",
    patch: "Update",
    delete: "Delete",
  };
  return `${methodNames[method] ?? method.toUpperCase()} ${resource}`;
}

function getResourceName(apiPath: string): string {
  const parts = apiPath
    .split("/")
    .filter((p) => !p.startsWith("{") && p !== "api" && p !== "v1" && p !== "v3")
    .filter(Boolean);
  const last = parts[parts.length - 1] ?? "resource";
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function generateFileName(
  method: string,
  apiPath: string,
  op: OpenAPIOperation
): string {
  if (op.summary) {
    const s = slugify(op.summary);
    return s.length > 40 ? s.substring(0, 40).replace(/-$/, "") : s;
  }

  const resource = getResourceName(apiPath);
  const hasParam = apiPath.includes("{");

  const methodVerb: Record<string, string> = {
    get: hasParam ? "get" : "list",
    post: hasParam ? "action" : "create",
    put: "update",
    patch: "update",
    delete: "delete",
  };

  const verb = methodVerb[method] ?? method;
  const base = slugify(`${verb}-${resource}`);

  // Add sub-resource context if path has depth
  const parts = apiPath.split("/").filter(Boolean);
  const nonParam = parts.filter((p) => !p.startsWith("{"));
  if (nonParam.length > 3) {
    const extra = nonParam.slice(-1)[0];
    if (extra && extra !== slugify(resource).replace(/-/g, "")) {
      return slugify(`${verb}-${resource}-${extra}`);
    }
  }

  return base;
}

/**
 * How much of `apiPath` this group's best prefix covers, or 0 when none match.
 * Ownership goes to the longest match, so `/api/gateway/v1/spend-events` beats
 * a shorter sibling prefix and a sub-path like `/spend-events/replay` lands in
 * the same group as its parent instead of nowhere.
 */
function matchStrength(apiPath: string, group: EndpointGroup): number {
  let best = 0;
  for (const prefix of group.pathPrefixes) {
    if (
      apiPath === prefix ||
      apiPath.startsWith(prefix + "/") ||
      apiPath.startsWith(prefix + "?")
    ) {
      best = Math.max(best, prefix.length);
    }
  }
  return best;
}

/** The group that owns each spec path, by longest matching prefix. */
function resolveOwners(specPaths: string[]): Map<string, EndpointGroup> {
  const owners = new Map<string, EndpointGroup>();
  for (const apiPath of specPaths) {
    if (Object.hasOwn(SKIP_PATHS, apiPath)) continue;
    let winner: EndpointGroup | undefined;
    let winningStrength = 0;
    for (const group of ENDPOINT_GROUPS) {
      const strength = matchStrength(apiPath, group);
      if (strength > winningStrength) {
        winner = group;
        winningStrength = strength;
      }
    }
    if (winner) owners.set(apiPath, winner);
  }
  return owners;
}

function findExistingMdxFiles(dirPath: string): Map<string, string> {
  const openapiToFile = new Map<string, string>();
  if (!fs.existsSync(dirPath)) return openapiToFile;

  for (const file of fs.readdirSync(dirPath).sort()) {
    if (!file.endsWith(".mdx")) continue;
    const content = fs.readFileSync(path.join(dirPath, file), "utf-8");
    const match = content.match(/^openapi:\s*['"]?(.+?)['"]?\s*$/m);
    if (match) {
      const ref = match[1]!;
      if (!openapiToFile.has(ref)) {
        openapiToFile.set(ref, file.replace(".mdx", ""));
      }
    }
  }
  return openapiToFile;
}

function sortScore(method: string, apiPath: string): number {
  const hasParam = apiPath.includes("{");
  if (method === "get" && !hasParam) return 0;
  if (method === "post" && !hasParam) return 1;
  if (method === "get" && hasParam) return 2;
  if (method === "put" && !hasParam) return 2.5;
  if (method === "put" && hasParam) return 3;
  if (method === "patch" && hasParam) return 3;
  if (method === "post" && hasParam) return 4;
  if (method === "delete") return 5;
  return 6;
}

function main() {
  const spec: OpenAPISpec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf-8"));
  const docsJson = JSON.parse(fs.readFileSync(DOCS_JSON_PATH, "utf-8"));

  type NavPage = string | { group: string; pages: string[] };
  const allNavGroups: Array<{ group: string; pages: NavPage[] }> = [];
  let totalCreated = 0;
  let totalExisting = 0;

  const owners = resolveOwners(Object.keys(spec.paths));

  const unowned = Object.keys(spec.paths).filter(
    (apiPath) => !Object.hasOwn(SKIP_PATHS, apiPath) && !owners.has(apiPath)
  );
  if (unowned.length > 0) {
    const noun = unowned.length === 1 ? "spec path has" : "spec paths have";
    console.error(
      `ERROR: ${unowned.length} ${noun} no ENDPOINT_GROUPS entry and no SKIP_PATHS reason:`
    );
    for (const apiPath of unowned.sort()) console.error(`  ${apiPath}`);
    console.error(
      "\nEvery path above needs one of two resolutions in docs/scripts/generate-api-reference-pages.ts:"
    );
    console.error(
      "  1. add an ENDPOINT_GROUPS entry covering it, so the path gets a reference page, or"
    );
    console.error(
      "  2. add a SKIP_PATHS entry whose reason says why it is deliberately undocumented, either a retired surface or a live surface not yet documented in the API reference."
    );
    process.exit(1);
  }

  for (const group of ENDPOINT_GROUPS) {
    const dirPath = path.join(API_REF_DIR, group.dirName);
    fs.mkdirSync(dirPath, { recursive: true });

    const existingMdx = findExistingMdxFiles(dirPath);

    const endpoints: Array<{
      method: string;
      path: string;
      op: OpenAPIOperation;
    }> = [];

    for (const [apiPath, methods] of Object.entries(spec.paths)) {
      if (owners.get(apiPath) !== group) continue;

      for (const [method, op] of Object.entries(methods)) {
        if (!METHOD_ORDER.includes(method)) continue;
        endpoints.push({ method, path: apiPath, op });
      }
    }

    if (endpoints.length === 0) continue;

    // A declared order wins; everything it does not name keeps the CRUD sort
    // and follows behind, so adding a route never silently reshuffles the rest.
    const declaredOrder = group.endpointOrder ?? [];
    const declaredIndex = ({
      method,
      apiPath,
    }: {
      method: string;
      apiPath: string;
    }): number => {
      const at = declaredOrder.indexOf(`${method.toUpperCase()} ${apiPath}`);
      return at === -1 ? Number.MAX_SAFE_INTEGER : at;
    };

    endpoints.sort((a, b) => {
      const aDeclared = declaredIndex({ method: a.method, apiPath: a.path });
      const bDeclared = declaredIndex({ method: b.method, apiPath: b.path });
      if (aDeclared !== bDeclared) return aDeclared - bDeclared;
      const aScore = sortScore(a.method, a.path);
      const bScore = sortScore(b.method, b.path);
      if (aScore !== bScore) return aScore - bScore;
      return a.path.localeCompare(b.path);
    });

    // Write overview page
    const overviewPath = path.join(dirPath, "overview.mdx");
    if (!fs.existsSync(overviewPath)) {
      fs.writeFileSync(
        overviewPath,
        `---\ntitle: "Overview"\ndescription: "${group.overviewDescription}"\n---\n\n## Intro\n\n${group.overviewDescription}\n`
      );
      totalCreated++;
    } else {
      totalExisting++;
    }

    const pages: string[] = [`api-reference/${group.dirName}/overview`];
    const usedNames = new Set<string>(["overview"]);

    for (const ep of endpoints) {
      const openapiRef = `${ep.method.toUpperCase()} ${ep.path}`;

      // Reuse existing MDX file if one already points to this endpoint
      const existingName = existingMdx.get(openapiRef);
      if (existingName && !usedNames.has(existingName)) {
        pages.push(`api-reference/${group.dirName}/${existingName}`);
        usedNames.add(existingName);
        totalExisting++;
        continue;
      }

      let fileName = generateFileName(ep.method, ep.path, ep.op);
      if (usedNames.has(fileName)) {
        fileName = `${ep.method}-${fileName}`;
      }
      if (usedNames.has(fileName)) {
        const suffix =
          ep.path.split("/").pop()?.replace(/[{}]/g, "") ?? "ep";
        fileName = `${fileName}-${suffix}`;
      }
      usedNames.add(fileName);

      const title = generateTitle(ep.method, ep.path, ep.op);
      const mdxPath = path.join(dirPath, `${fileName}.mdx`);

      if (!fs.existsSync(mdxPath)) {
        fs.writeFileSync(
          mdxPath,
          `---\ntitle: "${title}"\nopenapi: "${openapiRef}"\n---\n`
        );
        totalCreated++;
      } else {
        totalExisting++;
      }

      pages.push(`api-reference/${group.dirName}/${fileName}`);
    }

    allNavGroups.push({ group: group.name, pages });

    // Insert Built-in Evaluators (categorized) right after the Evaluators config group
    if (group.dirName === "evaluators-config") {
      allNavGroups.push({
        group: "Built-in Evaluators",
        pages: buildBuiltInEvaluatorNav(),
      });
    }
  }

  // Update docs.json navigation
  const apiRefAnchor = docsJson.navigation.anchors.find(
    (a: { anchor: string }) => a.anchor === "API Reference"
  );
  if (apiRefAnchor) {
    apiRefAnchor.groups = allNavGroups;
  }

  fs.writeFileSync(DOCS_JSON_PATH, JSON.stringify(docsJson, null, 2) + "\n");

  console.log(`Created ${totalCreated} new MDX pages`);
  console.log(`Skipped ${totalExisting} existing pages`);
  console.log(`Updated docs.json with ${allNavGroups.length} API groups`);
}

const BUILTIN_EVALUATOR_CATEGORIES: Record<string, string[]> = {
  "Expected Answer": [
    "exact-match-evaluator",
    "llm-answer-match",
    "llm-factual-match",
    "bleu-score",
    "rouge-score",
    "sql-query-equivalence",
    "semantic-similarity-evaluator",
  ],
  "LLM as Judge": [
    "llm-as-a-judge-boolean-evaluator",
    "llm-as-a-judge-category-evaluator",
    "llm-as-a-judge-score-evaluator",
    "rubrics-based-scoring",
    "custom-basic-evaluator",
    "summarization-score",
  ],
  "RAG Quality": [
    "ragas-answer-correctness",
    "ragas-answer-relevancy",
    "ragas-context-precision",
    "ragas-context-recall",
    "ragas-context-relevancy",
    "ragas-context-utilization",
    "ragas-faithfulness",
    "ragas-faithfulness-1",
    "ragas-response-context-precision",
    "ragas-response-context-recall",
    "ragas-response-relevancy",
    "context-f1",
    "context-precision",
    "context-recall",
  ],
  "Quality Aspects": [
    "lingua-language-detection",
    "valid-format-evaluator",
    "off-topic-evaluator",
    "query-resolution",
  ],
  Safety: [
    "azure-content-safety",
    "azure-jailbreak-detection",
    "azure-prompt-shield",
    "openai-moderation",
    "presidio-pii-detection",
    "competitor-blocklist",
    "competitor-allowlist-check",
    "competitor-llm-check",
  ],
};

function buildBuiltInEvaluatorNav(): (
  | string
  | { group: string; pages: string[] }
)[] {
  const p = (name: string) => `api-reference/evaluators/${name}`;
  const pages: (string | { group: string; pages: string[] })[] = [p("overview")];

  for (const [category, evaluators] of Object.entries(
    BUILTIN_EVALUATOR_CATEGORIES
  )) {
    pages.push({
      group: category,
      pages: evaluators.map(p),
    });
  }

  return pages;
}

main();

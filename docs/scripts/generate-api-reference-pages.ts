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
}

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;

// Legacy paths that have modern equivalents - skip these
const SKIP_PATHS = new Set([
  "/api/trace/search", // use /api/traces/search
  "/api/trace/{id}", // use /api/traces/{traceId}
  "/", // root endpoints from prompts app (not real API routes)
]);

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
    name: "Evaluations v3",
    dirName: "evaluations",
    pathPrefixes: ["/api/evaluations"],
    overviewDescription:
      "Run and monitor evaluation experiments. Start evaluation runs and poll for progress and results.",
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
    pathPrefixes: ["/api/triggers"],
    overviewDescription:
      "Manage automation triggers that fire actions based on trace events. Create Slack notifications, webhooks, and other automated responses.",
  },
  {
    name: "Workflows",
    dirName: "workflows",
    pathPrefixes: ["/api/workflows"],
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
    name: "Gateway: Provider Bindings",
    dirName: "gateway-providers",
    pathPrefixes: ["/api/gateway/v1/providers"],
    overviewDescription:
      "Manage provider credential bindings for the AI Gateway. Bind model providers (OpenAI, Anthropic, etc.) to enable routing through the gateway.",
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

function matchesGroup(apiPath: string, group: EndpointGroup): boolean {
  for (const prefix of group.pathPrefixes) {
    if (
      apiPath === prefix ||
      apiPath.startsWith(prefix + "/") ||
      apiPath.startsWith(prefix + "?")
    ) {
      if (prefix.includes("gateway/v1/")) {
        const remainder = apiPath.substring(prefix.length).replace(/^\//, "");
        if (remainder && !remainder.startsWith("{")) continue;
      }
      return true;
    }
  }
  return false;
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

  const claimedPaths = new Set<string>();

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
      if (SKIP_PATHS.has(apiPath)) continue;
      if (!matchesGroup(apiPath, group)) continue;
      if (claimedPaths.has(apiPath)) continue;
      claimedPaths.add(apiPath);

      for (const [method, op] of Object.entries(methods)) {
        if (!METHOD_ORDER.includes(method)) continue;
        endpoints.push({ method, path: apiPath, op });
      }
    }

    if (endpoints.length === 0) continue;

    endpoints.sort((a, b) => {
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

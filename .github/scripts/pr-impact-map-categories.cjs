// Classifies one changed path into a PR impact-map category and, for module
// paths, names the module. First match wins, so order is load-bearing.
// Used by pr-impact-map.yml; spec: specs/ci/pr-impact-map.feature

const MODULE = /^(?:enterprise\/)?modules\/([^/]+)\/(contract|process|browser|client)\//;

const CATEGORIES = [
  [
    "Migrations",
    (p) =>
      /^packages\/prisma-client\/prisma\/migrations\//.test(p) ||
      /^packages\/clickhouse-migrations\/migrations\//.test(p) ||
      /^(?:enterprise\/)?modules\/[^/]+\/(?:contract|process)\/src\/migrations\//.test(p) ||
      p.endsWith("schema.prisma"),
  ],
  [
    "Specs",
    (p) =>
      p.startsWith("specs/") ||
      /^(?:enterprise\/)?modules\/[^/]+\/specs\//.test(p) ||
      /^packages\/[^/]+\/specs\//.test(p),
  ],
  [
    "Tests",
    (p) =>
      /(^|\/)(__tests__|tests)\//.test(p) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) ||
      /_test\.go$/.test(p) ||
      /(^|\/)test_[^/]+\.py$/.test(p) ||
      p.startsWith("dev/tests/agentic-e2e/"),
  ],
  ["CI/CD", (p) => p.startsWith(".github/")],
  [
    "Deploy",
    (p) => p.startsWith("charts/") || /(^|\/)Dockerfile[^/]*$/.test(p) || /^infra\//.test(p),
  ],
  [
    "Docs",
    (p) =>
      p.startsWith("docs/") ||
      p.startsWith("dev/docs/") ||
      p.startsWith("skills/") ||
      /^(?:enterprise\/)?modules\/[^/]+\/adrs\//.test(p) ||
      p.endsWith(".md") ||
      p.endsWith(".mdx"),
  ],
  [
    "Deps",
    (p) => /(^|\/)(pnpm-lock\.yaml|go\.sum|uv\.lock|poetry\.lock)$/.test(p) || p.endsWith(".lock"),
  ],
  ["Modules · contract", (p) => MODULE.exec(p)?.[2] === "contract"],
  ["Modules · process", (p) => MODULE.exec(p)?.[2] === "process"],
  ["Modules · browser", (p) => MODULE.exec(p)?.[2] === "browser"],
  ["Modules · client", (p) => MODULE.exec(p)?.[2] === "client"],
  ["SDKs", (p) => /^(sdks|mcp)\//.test(p)],
  ["Framework", (p) => p.startsWith("packages/") || /^(?:enterprise\/)?modules\//.test(p)],
  ["Apps", (p) => p.startsWith("apps/")],
  ["Tools", (p) => p.startsWith("tools/") || p.startsWith("dev/")],
  // Python precedes "Go services": services/langevals starts with `services/`.
  ["Python", (p) => /^services\/langevals\//.test(p)],
  ["Go services", (p) => /^(services|pkg|cmd)\//.test(p) || p === "go.mod"],
  ["Other", () => true],
];

const classify = (path) => CATEGORIES.find(([, test]) => test(path))[0];

/** The module a path belongs to, or null when it is not under a module. */
const moduleOf = (path) => /^(?:enterprise\/)?modules\/([^/]+)\//.exec(path)?.[1] ?? null;

module.exports = { CATEGORIES, classify, moduleOf };

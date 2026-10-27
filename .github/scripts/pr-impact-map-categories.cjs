// Classifies one changed path into a PR impact-map category and, for module
// paths, names the module. First match wins, so order is load-bearing.
// Used by pr-impact-map.yml; spec: specs/ci/pr-impact-map.feature

const MODULE = /^(?:enterprise\/)?modules\/([^/]+)\/(contract|process|browser|client)\//;

const LOCKFILE =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|go\.sum|go\.work\.sum|uv\.lock|poetry\.lock)$/;

/** One .gitattributes glob as a regex over a repo-relative path (gitignore rules). */
const globToRegExp = (glob) => {
  const anchored = glob.startsWith("/") || glob.replace(/\/$/, "").includes("/");
  const body = glob.replace(/^\//, "");
  let re = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (body.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (body.startsWith("/**", i) && i + 3 === body.length) {
      re += "/.*";
      i += 2;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${re}$`);
};

/** The linguist-generated value one attribute token sets, or null when it sets none. */
const generatedValue = (attr) => {
  if (attr === "linguist-generated" || attr === "linguist-generated=true") return true;
  if (/^[-!]linguist-generated$|^linguist-generated=false$/.test(attr)) return false;
  return null;
};

/** One .gitattributes line as [regex, value] rules for linguist-generated. */
const rulesOf = (line) => {
  const [glob, ...attrs] = line.trim().split(/\s+/);
  if (!glob || glob.startsWith("#")) return [];
  return attrs
    .map(generatedValue)
    .filter((value) => value !== null)
    .map((value) => [globToRegExp(glob), value]);
};

/**
 * A predicate over paths from .gitattributes text: true when the last line
 * matching the path sets linguist-generated (git's last-match-wins).
 */
const generatedMatcher = (gitattributes) => {
  const rules = gitattributes.split("\n").flatMap(rulesOf);
  return (path) => {
    let generated = false;
    for (const [re, value] of rules) if (re.test(path)) generated = value;
    return generated;
  };
};

const CATEGORIES = [
  [
    "Migrations",
    (p) =>
      p.startsWith("packages/prisma-client/prisma/migrations/") ||
      p.startsWith("packages/clickhouse-migrations/migrations/") ||
      /^(?:enterprise\/)?modules\/[^/]+\/(?:contract|process)\/src\/migrations\//.test(p) ||
      p.endsWith("schema.prisma"),
  ],
  // Regenerated output (.gitattributes linguist-generated), so a README or
  // client regeneration is not counted as module work. Lockfiles stay in Deps.
  ["Generated", (p, { isGenerated }) => isGenerated(p) && !LOCKFILE.test(p)],
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
      p.endsWith("_test.go") ||
      /(^|\/)test_[^/]+\.py$/.test(p) ||
      p.startsWith("dev/tests/agentic-e2e/"),
  ],
  ["CI/CD", (p) => p.startsWith(".github/") || p.startsWith(".githooks/")],
  [
    "Deploy",
    (p) => p.startsWith("charts/") || /(^|\/)Dockerfile[^/]*$/.test(p) || p.startsWith("infra/"),
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
    (p) =>
      LOCKFILE.test(p) ||
      p.endsWith(".lock") ||
      p.startsWith("patches/") ||
      p.startsWith("vendor/"),
  ],
  ["Modules · contract", (p) => MODULE.exec(p)?.[2] === "contract"],
  ["Modules · process", (p) => MODULE.exec(p)?.[2] === "process"],
  ["Modules · browser", (p) => MODULE.exec(p)?.[2] === "browser"],
  ["Modules · client", (p) => MODULE.exec(p)?.[2] === "client"],
  ["SDKs", (p) => /^(sdks|mcp|plugins)\//.test(p)],
  ["Framework", (p) => /^(?:enterprise\/)?(packages|modules)\//.test(p)],
  ["Apps", (p) => p.startsWith("apps/")],
  // cmd/ holds the tools' entry points, except cmd/service: the Go services binary.
  [
    "Tools",
    (p) =>
      /^(tools|dev|\.claude)\//.test(p) || (p.startsWith("cmd/") && !p.startsWith("cmd/service/")),
  ],
  // Python precedes "Go services": services/langevals starts with `services/`.
  ["Python", (p) => p.startsWith("services/langevals/")],
  ["Go services", (p) => /^(services|pkg|cmd)\//.test(p) || p === "go.mod" || p === "go.work"],
  ["Other", () => true],
];

const NOTHING_GENERATED = () => false;

/** The category of one path; `isGenerated` comes from generatedMatcher. */
const classify = (path, { isGenerated = NOTHING_GENERATED } = {}) =>
  CATEGORIES.find(([, test]) => test(path, { isGenerated }))[0];

/** The module a path belongs to, or null when it is not under a module. */
const moduleOf = (path) => /^(?:enterprise\/)?modules\/([^/]+)\//.exec(path)?.[1] ?? null;

module.exports = { CATEGORIES, classify, generatedMatcher, moduleOf };

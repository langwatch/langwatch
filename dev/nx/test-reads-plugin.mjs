import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { memberPatterns } from "./workspace-members.mjs";

// Gives every workspace member a `testReads` named input: the files outside its
// package that its tests read from disk (measured, not guessed: ADR-150). The
// test targets take it, so editing one of those files misses the cache and
// makes the reader affected. A member absent from the table reads nothing.
const sourceRoots = [
  "modules/**/*",
  "enterprise/**/*",
  "packages/**/*",
  "apps/**/*",
  "sdks/**/*",
  "mcp/**/*",
  "services/**/*",
];
export const reads = {
  "@langwatch/time": sourceRoots,
  "@langwatch/handled-error": [
    ...sourceRoots,
    "docs/agent-testing/**/*",
    "docs/api-reference/**/*",
    "docs/evaluations/**/*",
    "docs/platform/**/*",
    "docs/pricing.mdx",
    "docs/self-hosting/connect.mdx",
  ],
  "@langwatch/csv": sourceRoots,
  "@langwatch/scenario-contract": sourceRoots,
  "@langwatch/analytics-process": [
    "dev/docs/**/*",
    "docs/api-reference/query/**/*",
    "mcp/typescript/src/__tests__/fixtures/**/*",
    "modules/trace/process/src/repositories/clickhouse/trace-legacy-read.repository.ts",
  ],
  "@langwatch/stored-object-process": [
    "modules/**/*",
    "enterprise/modules/**/*",
    "apps/tasks/**/*",
    "apps/worker/**/*",
    "charts/langwatch/**/*",
    "docs/self-hosting/**/*",
    "packages/clickhouse-migrations/migrations/00023_create_stored_objects.sql",
    ".env.example",
  ],
  "@langwatch/workflow-process": [
    "sdks/go/**/*",
    "services/nlpgo/**/*",
    "pkg/**/*",
    "cmd/service/**/*",
    "*/go.{mod,sum}",
    "go.work",
    "go.work.sum",
  ],
  "@langwatch/internal-slack": ["modules/automation/**/*", ".oxlintrc.jsonc"],
  "@langwatch/identity-process": ["modules/auth/**/*"],
  "@langwatch/clickhouse-client": ["packages/clickhouse-migrations/**/*"],
  "@langwatch/evaluator-contract": [
    "skills/**/*",
    "feature-map.json",
    "services/langyagent/internal/assets/AGENTS.md",
  ],
  "@langwatch/skills": ["services/langyagent/**/*", "docs/**/*", "feature-map.json"],
  langwatch: [
    "skills/**/*",
    "packages/redaction/**/*",
    "specs/webhooks/**/*",
    "plugins/langwatch/**/*",
    "modules/agent/contract/src/connected-agent.protocol.ts",
  ],
  "@langwatch/evaluation-process": ["charts/langwatch/**/*", "docs/self-hosting/**/*"],
  "@langwatch/auth-process": ["charts/langwatch/**/*", "docs/self-hosting/**/*"],
  "@langwatch/ops-process": ["docs/self-hosting/**/*", "docs/ai-gateway/**/*", "docs/docs.json"],
  "@langwatch/webhook-process": ["specs/webhooks/**/*"],
  "@langwatch/egress": ["pkg/ssrf/testdata/**/*", "go.work"],
  "@langwatch/langy-browser": ["services/langyagent/**/*", "infra/docker/Dockerfile.langyagent"],
  "@langwatch/langy-contract": ["services/langyagent/**/*"],
  "@langwatch/enterprise-billing-process": ["docs/pricing/**/*", "docs/pricing.mdx"],
  "@langwatch/trace-process": [
    "modules/analytics/process/src/repositories/clickhouse/clickhouse.aggregation-builder.mapper.ts",
    "modules/scenario/process/src/repositories/clickhouse/simulation-clickhouse.repository.ts",
    "modules/experiment/process/src/repositories/clickhouse/clickhouse.experiment-run.repository.ts",
  ],
  "@langwatch/annotation-process": [
    "modules/annotation/browser/src/behavior/annotation-api.ts",
    "modules/annotation/browser/src/behavior/annotation-scores-api.ts",
  ],
  "@langwatch/automation-contract": ["modules/automation/**/*"],
  "@langwatch/config": ["packages/browser/src/public-config.ts"],
  "@langwatch/mail": ["skills/tracing/SKILL.mdx"],
  "@langwatch/mcp-server": ["feature-map.json"],
  "@langwatch/plans": ["packages/prisma-client/prisma/schema.prisma"],
  "@langwatch/langy-process": ["specs/langy/langy-frame-auth.vectors.json"],
  "@langwatch/oxlint-rules": [
    ".oxlintrc.jsonc",
    "packages/architecture-enforcer/oxlint.architecture.jsonc",
  ],
  "@langwatch/usage-process": ["docs/pricing.mdx", "docs/pricing/billable-events.mdx"],
  "@langwatch/instant-eval-process": ["docs/pricing.mdx"],
  "@langwatch/langyworker": ["skills/guided-onboarding/SKILL.mdx"],
  "@langwatch/visual-diff-runner": ["tools/visualdiff/config.go"],
  "@langwatch/experiment-browser": [
    "services/langevals/evaluators/langevals/langevals_langevals/select_best_compare.py",
  ],
  "@langwatch/enterprise-governance-process": ["enterprise/modules/governance/browser/src/**/*"],
  // The whole-tree policies read every source area and the root configuration they police.
  "@langwatch/architecture-enforcer": [
    "modules/**/*",
    "enterprise/**/*",
    "apps/**/*",
    "packages/**/*",
    "mcp/**/*",
    "sdks/**/*",
    "plugins/**/*",
    "services/**/*",
    "skills/**/*",
    "tools/**/*",
    "cmd/**/*",
    "pkg/**/*",
    "dev/**/*",
    "specs/tooling/**/*",
    "infra/clickhouse-serverless/**/*",
    "infra/docker/Dockerfile.langyagent",
    "docs/integration/**/*",
    "docs/scripts/**/*",
    "docs/snippets/**/*",
    "docs/*.{mdx,txt,js,css}",
    ".claude/coordinator/**/*",
    ".claude/skills/**/*",
    ".github/actions/**/*",
    ".github/scripts/**/*",
    ".github/workflows/**/*",
    ".github/release-please-config.json",
    ".github/.release-please-manifest.json",
    ".oxlintrc.jsonc",
    ".oxfmtrc.json",
    ".gitignore",
    ".npmrc",
    ".env.example",
    "package.json",
    "pnpm-lock.yaml",
    "pyproject.toml",
    "uv.lock",
    "tsconfig*.json",
  ],
  // The pack tests read each workspace member's manifest and tsconfigs.
  "@langwatch/server": [
    "modules/*/*/{package.json,tsconfig*.json}",
    "enterprise/modules/*/*/{package.json,tsconfig*.json}",
    "enterprise/packages/*/{package.json,tsconfig*.json}",
    "packages/*/{package.json,tsconfig*.json}",
    "packages/mail/preview/{package.json,tsconfig*.json}",
    "apps/*/{package.json,tsconfig*.json}",
    "mcp/typescript/{package.json,tsconfig*.json}",
    "plugins/langwatch/package.json",
    "services/langyworker/package.json",
    "skills/{package.json,tsconfig*.json}",
    "tools/dev-runtime/package.json",
    "tools/interactionsimulator/package.json",
    "tools/{fuzz,visualdiff}/runner/package.json",
    "tools/devscripts/ensurebuilt.go",
    "dev/dogfood/acme-support/typescript/package.json",
    "dev/scripts/**/*",
    "dev/tests/*/package.json",
    "dev/tsconfig*.json",
    "package.json",
    "tsconfig*.json",
  ],
  "@langwatch/user-browser": ["docs/coding-agents/explore-your-usage-with-your-own-agent.mdx"],
};

const members = memberPatterns(new URL("../..", import.meta.url).pathname);

export const createNodes = [
  `{${members.join(",")}}/package.json`,
  (files, _options, context) =>
    files.map((file) => {
      const root = dirname(file);
      const { name } = JSON.parse(readFileSync(join(context.workspaceRoot, file), "utf8"));
      const testReads = (reads[name] ?? []).map((glob) => `{workspaceRoot}/${glob}`);
      return [file, { projects: { [root]: { namedInputs: { testReads } } } }];
    }),
];

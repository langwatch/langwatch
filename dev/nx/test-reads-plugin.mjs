import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { memberPatterns } from "./workspace-members.mjs";

// Gives every workspace member a `testReads` named input: the files outside its
// package that its tests read from disk (measured, not guessed: ADR-150). The
// test targets take it, so editing one of those files misses the cache and
// makes the reader affected. A member absent from the table reads nothing.
const sourceRoots = [
  "modules/**/*",
  "enterprise/modules/**/*",
  "packages/**/*",
  "apps/**/*",
  "sdks/**/*",
  "mcp/**/*",
  "services/**/*",
];
const reads = {
  "@langwatch/time": sourceRoots,
  "@langwatch/handled-error": sourceRoots,
  "@langwatch/csv": sourceRoots,
  "@langwatch/error-presentation": sourceRoots,
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
  ],
  "@langwatch/workflow-process": ["sdks/go/**/*", "services/nlpgo/**/*", "pkg/**/*"],
  "@langwatch/internal-slack": ["modules/automation/**/*", ".oxlintrc.jsonc"],
  "@langwatch/identity-process": ["modules/auth/**/*"],
  "@langwatch/clickhouse-client": ["packages/clickhouse-migrations/**/*"],
  "@langwatch/evaluator-contract": ["skills/**/*"],
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
  "@langwatch/egress": ["specs/webhooks/**/*", "pkg/ssrf/testdata/**/*", "go.work"],
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
  "@langwatch/config": ["packages/ui-kernel/src/public-config.ts"],
  "@langwatch/mail": ["skills/tracing/SKILL.mdx"],
  "@langwatch/mcp-server": ["feature-map.json"],
  "@langwatch/plans": ["packages/prisma-client/prisma/schema.prisma"],
  "@langwatch/langy-process": ["specs/langy/langy-frame-auth.vectors.json"],
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

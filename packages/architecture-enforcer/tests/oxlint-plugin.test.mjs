import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { commentBlockSizeMessage } from "@langwatch/oxlint-rules/grammar/comment-block-policy.mjs";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import plugin from "../oxlint-plugin.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const tester = new RuleTester({
  cwd: repositoryRoot,
  languageOptions: { sourceType: "module" },
});

/** @scenario "LangWatch house rules keep executable fixtures" */
/** @scenario "Retired package surfaces cannot remain in application code" */
tester.run("package-boundaries", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "modules/agent/contract/src/example.ts",
      code: 'import { z } from "zod"; export const value = z.string();',
    },
    {
      filename: "modules/agent/process/src/repositories/prisma/example.ts",
      code: 'import type { PrismaClient } from "@prisma/client"; export type Db = PrismaClient;',
    },
  ],
  invalid: [
    {
      filename: "modules/agent/contract/src/example.ts",
      code: 'import React from "react"; export { React };',
      errors: [{ messageId: "contractRuntime" }],
    },
    {
      filename: "modules/agent/process/src/example.ts",
      code: 'import type { ReactNode } from "react"; export type Value = ReactNode;',
      errors: [{ messageId: "processImportsBrowser" }],
    },
    {
      filename: "mcp/typescript/src/example.ts",
      code: 'import { AgentService } from "@langwatch/agent-process"; export { AgentService };',
      errors: [{ messageId: "processOutsideModule" }],
    },
    {
      filename: "mcp/typescript/src/__tests__/agent.integration.test.ts",
      code: 'import { AgentService } from "@langwatch/agent-process"; export { AgentService };',
      errors: [{ messageId: "processOutsideModule" }],
    },
    {
      filename: "modules/agent/contract/src/example.ts",
      code: 'export { AgentService } from "../../server/src";',
      errors: [{ messageId: "unownedEscape" }],
    },
    {
      filename: "modules/entitlement/contract/src/example.ts",
      code: 'export { Agent } from "@langwatch/agent-contract/private";',
      errors: [{ messageId: "sealedExports" }],
    },
    {
      filename: "modules/agent/process/src/example.ts",
      code: 'import { zValidator } from "@hono/zod-validator"; export { zValidator };',
      errors: [{ messageId: "schemaBoundary" }],
    },
    {
      filename: "modules/agent/contract/src/example.ts",
      code: 'import { z } from "zod/v3"; export const value = z.string();',
      errors: [{ messageId: "retiredPackageRuntime" }],
    },
    {
      filename: "mcp/typescript/src/example.ts",
      code: 'import { cadence } from "@langwatch/automations/cadences"; export { cadence };',
      errors: [{ messageId: "retiredPackageRuntime" }],
    },
    {
      filename: "mcp/typescript/src/example.ts",
      code: 'import { service } from "@ee/governance/service"; export { service };',
      errors: [{ messageId: "retiredPackageRuntime" }],
    },
    {
      filename: "modules/agent/process/src/example.ts",
      code: 'import { resolver } from "hono-openapi/zod"; export { resolver };',
      errors: [{ messageId: "schemaBoundary" }],
    },
  ],
});

/** @scenario "LangWatch house rules keep executable fixtures" */
/** @scenario "Feature packages receive validated environment configuration" */
tester.run("environment-boundaries", plugin.rules["environment-boundaries"], {
  valid: [
    {
      filename: "modules/agent/tests/example.test.ts",
      code: "export const value = process.env.TEST_VALUE;",
    },
    {
      filename: "packages/architecture-enforcer/tests/environment.test.ts",
      code: "export const value = process.env.TEST_VALUE;",
    },
    {
      filename: "packages/redaction/src/__bench__/secrets.bench.ts",
      code: "export const value = process.env.BENCHMARK_VALUE;",
    },
    {
      filename: "modules/agent/process/src/testing/runtime.spec.ts",
      code: "export const value = process.env.TEST_VALUE;",
    },
    {
      filename: "packages/eventing/src/probe.ts",
      code: 'const env = "not-env"; export const value = process[env];',
    },
    {
      // The npx CLI installs and supervises the other processes, so spawning
      // with an environment is its subject matter rather than a leak.
      filename: "apps/server/src/services/postgres.ts",
      code: "export const value = process.env.POSTGRES_URL;",
    },
    {
      filename: "packages/eventing/src/probe.ts",
      code: 'const suffix = "nv"; export const value = process["e" + suffix];',
    },
    {
      filename: "mcp/typescript/src/example.ts",
      code: "export const value = process.env.APPLICATION_VALUE;",
    },
  ],
  invalid: [
    {
      filename: "modules/agent/contract/src/example.ts",
      code: "export const value = process.env.AGENTS_VALUE;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "packages/config/src/example.ts",
      code: "export const value = import.meta.env.CONFIG_VALUE;",
      errors: [{ messageId: "environment" }],
    },
    {
      // A feature inside a process app receives configuration like any other
      // consumer; only the composition root parses it.
      filename: "apps/api/src/features/scenario/scenario-event-rest.ts",
      code: "export const value = process.env.BASE_HOST;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "apps/worker/src/features/trace/trace-worker-feature.installer.ts",
      code: "export const value = process.env.TRACE_BATCH_SIZE;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "apps/ui/src/behavior/analytics-client.ts",
      code: "export const value = import.meta.env.POSTHOG_KEY;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "packages/eventing/src/services/event-sourcing.service.ts",
      code: "export const value = process.env.NODE_ENV;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "packages/observability/src/logger.ts",
      code: "export const value = import.meta.env.LOG_LEVEL;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "packages/prisma-client/src/config.ts",
      code: 'export const value = process["env"].DATABASE_URL;',
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "enterprise/packages/composition/api/src/config.ts",
      code: "export const value = process?.env.DATABASE_URL;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "enterprise/packages/composition/worker/src/config.ts",
      code: 'export const value = process?.["env"].QUEUE_URL;',
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "modules/agent/process/src/config.ts",
      code: "export const value = process[`env`].AGENT_KEY;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "modules/agent/process/src/config.ts",
      code: 'export const value = process["e" + "nv"].AGENT_KEY;',
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "packages/observability/src/logger.ts",
      code: 'export const value = import.meta["env"].LOG_LEVEL;',
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "modules/agent/process/src/runtime.unit.helper.ts",
      code: "export const value = process.env.AGENT_KEY;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "packages/architecture-enforcer/src/example.ts",
      code: "export const value = process.env.LINT_MODE;",
      errors: [{ messageId: "environment" }],
    },
  ],
});

/** @scenario "Contract production code cannot acquire runtime implementations" */
tester.run("package-boundaries: portable contracts", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "modules/agent/contract/src/agent.service.ts",
      code: 'import { z } from "zod"; export const agent = z.object({ id: z.string() });',
    },
  ],
  invalid: [
    {
      filename: "modules/agent/contract/src/agent.service.ts",
      code: 'import React from "react"; export { React };',
      errors: [{ messageId: "contractRuntime" }],
    },
    {
      filename: "modules/agent/contract/src/agent.service.ts",
      code: 'import { readFile } from "node:fs/promises"; export { readFile };',
      errors: [{ messageId: "contractRuntime" }],
    },
    {
      filename: "modules/agent/contract/src/agent.service.ts",
      code: 'import { AgentService } from "@langwatch/agent-process"; export { AgentService };',
      errors: [{ messageId: "contractRuntime" }],
    },
  ],
});

/** @scenario "Feature contracts remain transport-neutral" */
tester.run("package-boundaries: transport neutrality", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "modules/agent/contract/src/agent.command.ts",
      code: 'import { z } from "zod"; export const createAgent = z.object({ name: z.string() });',
    },
  ],
  invalid: [
    {
      filename: "modules/agent/contract/src/agent.command.ts",
      code: 'import { zValidator } from "@hono/zod-validator"; export { zValidator };',
      errors: [{ messageId: "schemaBoundary" }],
    },
    {
      filename: "modules/agent/contract/src/agent.command.ts",
      code: 'import { resolver } from "hono-openapi/zod"; export { resolver };',
      errors: [{ messageId: "schemaBoundary" }, { messageId: "contractRuntime" }],
    },
  ],
});

/** @scenario "Server production code cannot acquire browser dependencies" */
tester.run("package-boundaries: server stays headless", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: 'import type { Agent } from "@langwatch/agent-contract"; export type Value = Agent;',
    },
  ],
  invalid: [
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: 'import React from "react"; export { React };',
      errors: [{ messageId: "processImportsBrowser" }],
    },
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: 'import { Box } from "@chakra-ui/react"; export { Box };',
      errors: [{ messageId: "processImportsBrowser" }],
    },
  ],
});

/** @scenario "Only composition roots import feature server installers" */
tester.run("package-boundaries: server installers", plugin.rules["package-boundaries"], {
  valid: [],
  invalid: [
    {
      filename: "apps/ui/src/features/agent/ui/agent-list.tsx",
      code: 'import { AgentService } from "@langwatch/agent-process"; export { AgentService };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "sdks/typescript/src/example.ts",
      code: 'import { AgentService } from "@langwatch/agent-process"; export { AgentService };',
      errors: [{ messageId: "processOutsideModule" }],
    },
  ],
});

/** @scenario "A composition root's own tests import what the root imports" */
tester.run("package-boundaries: composition root tests", plugin.rules["package-boundaries"], {
  valid: [],
  invalid: [
    {
      filename: "sdks/typescript/src/__tests__/agent.unit.test.ts",
      code: 'import { AgentService } from "@langwatch/agent-process"; export { AgentService };',
      errors: [{ messageId: "processOutsideModule" }],
    },
  ],
});

/** @scenario "A relative import cannot escape its physical package" */
tester.run("package-boundaries: package escape", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: 'import type { AgentRepository } from "../repositories/agent.repository"; export type Value = AgentRepository;',
    },
  ],
  invalid: [
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: 'import type { Agent } from "../../../contract/src/agent.service"; export type Value = Agent;',
      errors: [{ messageId: "packageEscape" }],
    },
  ],
});

/** @scenario "An undeclared package subpath is not importable" */
tester.run("package-boundaries: sealed exports", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "modules/prompt/browser/src/prompt-list.tsx",
      code: 'import type { Agent } from "@langwatch/agent-contract"; export type Value = Agent;',
    },
  ],
  invalid: [
    {
      filename: "modules/prompt/browser/src/prompt-list.tsx",
      code: 'import type { Agent } from "@langwatch/agent-contract/src/agent.service"; export type Value = Agent;',
      errors: [{ messageId: "sealedExports" }],
    },
  ],
});

/** @scenario "Internal server dependencies point toward the service contract" */
tester.run("package-boundaries: feature layer direction", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "modules/agent/process/src/api/public/agent.api.ts",
      code: 'import type { AgentService } from "../../services/agent.service"; export type Value = AgentService;',
    },
  ],
  invalid: [],
});

tester.run("cognitive-complexity", plugin.rules["cognitive-complexity"], {
  valid: [
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function classify(a, b, c) { if (a) { return 1; } if (b) { return 2; } if (c) { return 3; } return 0; }",
      options: [{ max: 3 }],
    },
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export const pick = (a, b) => (a ? 1 : b ? 2 : 3);",
      options: [{ max: 3 }],
    },
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function outer(items) { return items.map((item) => { if (item) { return 1; } return 0; }); }",
      options: [{ max: 2 }],
    },
  ],
  invalid: [
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function classify(a, b, c) { if (a) { return 1; } if (b) { return 2; } if (c) { return 3; } return 0; }",
      options: [{ max: 2 }],
      errors: [{ messageId: "tooComplex" }],
    },
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function nested(a, b, c) { if (a) { for (const x of b) { while (c) { c = false; } } } }",
      options: [{ max: 5 }],
      errors: [{ messageId: "tooComplex" }],
    },
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function chain(a, b, c, d, e) { if (a && b && c || d || e) { return 1; } return 0; }",
      options: [{ max: 2 }],
      errors: [{ messageId: "tooComplexSpread" }],
    },
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function ternary(a) { return a ? (a ? 1 : 2) : 3; }",
      options: [{ max: 2 }],
      errors: [{ messageId: "tooComplex" }],
    },
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function loopWithArrow(items) { for (const item of items) { items.map((value) => (value ? 1 : 2)); } }",
      options: [{ max: 3 }],
      errors: [{ messageId: "tooComplex" }],
    },
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function countdown(n) { if (n > 0) { return countdown(n - 1); } return 0; }",
      options: [{ max: 1 }],
      errors: [{ messageId: "tooComplexSpread" }],
    },
  ],
});

tester.run("condition-shape", plugin.rules["condition-shape"], {
  valid: [
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function guard(input) { if (!input.id) { return null; } return input; }",
    },
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function ready(state) { if (state.loaded && state.visible) { return true; } return false; }",
    },
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function pick(state) { return state.enabled ? 1 : 0; }",
    },
    {
      filename: "modules/agent/process/src/services/agent.service.ts",
      code: "export function scan(rows) { while (rows.length) { rows.pop(); } }",
    },
  ],
  invalid: [],
});

// ---------------------------------------------------------------------------
// Policies that moved out of the architecture-enforcer CLI, so a reader sees them
// while typing rather than at the end of a whole-workspace run.

/** @scenario "A capability communicates absence through its name" */
tester.run("fallible-result-naming", plugin.rules["fallible-result-naming"], {
  valid: [
    {
      filename: "modules/project/contract/src/project.service.ts",
      code: "export abstract class ProjectService { abstract tryGetById(): Promise<string | null>; }",
    },
    {
      filename: "modules/project/contract/src/project.service.ts",
      code: "export abstract class ProjectService { abstract getById(): Promise<string>; }",
    },
    {
      filename: "modules/project/contract/src/project.service.ts",
      code: "export class EvaluationPreconditionService { requiredFieldsArePresent(): boolean { return true; } }",
    },
    {
      filename: "modules/project/process/src/services/project.service.ts",
      code: "export class ProjectService { getById(): Promise<string> { return Promise.resolve('project'); } private map(row: string | null): string | null { return row; } }",
    },
    {
      filename: "modules/project/process/src/app/project.app.ts",
      // The result type is what makes this valid: a `find*` may answer null,
      // but it has to say so. Without the annotation the rule reports
      // `noResultType`, which is the case directly below.
      code: "export class ProjectApp { findById(): string | null { return null; } }",
    },
    // Deliberate silences: a nullable `find*` is the shape ~1,217 existing methods
    // carry, left alone because converting one changes every caller (de197cba63).
    {
      filename: "modules/project/contract/src/project.service.ts",
      code: "export abstract class ProjectService { abstract findById(): Promise<string | null>; }",
    },
    {
      filename: "modules/project/process/src/ports/project.port.ts",
      code: "export abstract class ProjectRepositoryPort { abstract findById(): Promise<string | null>; }",
    },
    // `tryPrefix` fires only where a real catch turns a failure into an
    // absence, and an abstract method has no body to hold one. The naming
    // itself is `no-try-prefix`'s to complain about, which is the point of
    // `b0e9b4060b`: one complaint that is true rather than two that are not.
    {
      filename: "modules/project/contract/src/project.service.ts",
      code: "export abstract class ProjectService { abstract tryGetById(): Promise<string>; }",
    },
  ],
  invalid: [],
});

tester.run("feature-source-filename", plugin.rules["feature-source-filename"], {
  valid: [
    {
      filename: "modules/project/process/src/services/project.service.ts",
      code: "export const value = 1;",
    },
    {
      filename: "modules/project/process/src/repositories/prisma/prisma.project.repository.ts",
      code: "export const value = 1;",
    },
    {
      filename: "modules/project/process/src/services/__tests__/projectService.unit.test.ts",
      code: "export const value = 1;",
    },
  ],
  invalid: [
    {
      filename: "modules/project/process/src/services/projectService.service.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "filename" }],
    },
    {
      filename: "modules/project/browser/src/ui/ProjectPanel.tsx",
      code: "export const value = 1;",
      errors: [{ messageId: "filename" }],
    },
    {
      filename: "modules/project/process/src/repositories/prisma-project.repository.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "filename" }],
    },
  ],
});

/** @scenario Server artifacts have canonical homes and names */
/** @scenario Contract artifacts remain portable and named */
/** @scenario "A rules/ module is a pure package of functions" */
tester.run("feature-source-layout", plugin.rules["feature-source-layout"], {
  valid: [
    {
      filename: "modules/project/contract/src/project.service.ts",
      code: "export const value = 1;",
    },
    {
      filename: "modules/project/contract/src/index.ts",
      code: "export const value = 1;",
    },
    {
      filename: "modules/project/process/src/rules/project.rules.ts",
      code: "export const registry = new Map<string, string>();",
    },
    {
      filename: "modules/project/process/src/services/__tests__/project.unit.test.ts",
      code: "export class Helper {}",
    },
  ],
  invalid: [
    {
      filename: "modules/project/contract/src/service.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "contractMissingSubject" }],
    },
    {
      filename: "modules/project/process/src/services/project-process.service.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "processManagerService" }],
    },
    {
      filename: "modules/project/process/src/rules/project.rules.ts",
      code: "export class ProjectRules {}",
      errors: [{ messageId: "rulesImpurity" }],
    },
    {
      filename: "modules/project/process/src/rules/project.rules.ts",
      code: "import { Client } from './client'; export const client = new Client();",
      errors: [{ messageId: "rulesImpurity" }],
    },
  ],
});

/** @scenario "Every production subject has exactly one owner" */
/** @scenario "A broad feature cannot silently acquire a new subject" */
tester.run("feature-source-subject", plugin.rules["feature-source-subject"], {
  valid: [
    {
      filename: "modules/project/process/src/services/project.service.ts",
      code: "export const value = 1;",
    },
    {
      filename: "modules/project/process/src/index.ts",
      code: "export const value = 1;",
    },
    {
      filename: "modules/project/process/src/ports/notification.port.ts",
      code: "export const value = 1;",
    },
  ],
  invalid: [
    {
      filename: "modules/project/process/src/services/notification.service.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "foreignSubject" }],
    },
  ],
});

const layerFilename = "modules/project/process/src/services/example.service.ts";

tester.run("conditional-type-depth", plugin.rules["conditional-type-depth"], {
  valid: [
    {
      filename: layerFilename,
      code: "export type Resolve<T> = T extends A ? 1 : T extends B ? 2 : 3;",
    },
  ],
  invalid: [
    {
      filename: layerFilename,
      code: `export type Resolve<T> = T extends A
  ? 1
  : T extends B
    ? 2
    : T extends C
      ? 3
      : T extends D
        ? 4
        : 5;`,
      errors: [
        {
          message:
            "Type Resolve nests 4 conditional types; the maximum is 3." +
            " State the shape rather than deriving it. A type this deep is usually re-computing something a plain interface, a discriminated union, or a `satisfies` clause already says.",
        },
      ],
    },
  ],
});

tester.run("overload-by-literal", plugin.rules["overload-by-literal"], {
  valid: [
    {
      filename: layerFilename,
      code: `export function create(options: SchemaOptions): Config;
export function create(options: DefinitionOptions): Config;
export function create(options: SchemaOptions | DefinitionOptions): Config {
  return build(options);
}`,
    },
  ],
  invalid: [
    {
      filename: layerFilename,
      code: `export function configUrl(options?: { env?: string; optional?: false }): Leaf<string>;
export function configUrl(options: { env?: string; optional: true }): Leaf<string | undefined>;
export function configUrl(options?: { env?: string; optional?: boolean }): Leaf<string | undefined> {
  return leaf(options);
}`,
      errors: [
        {
          message:
            "configUrl carries overloads that differ only by `optional: true` versus `optional: false`." +
            " Give the two behaviours two names, or one signature whose return type already admits the absent case. An overload set the reader has to diff is not documentation.",
        },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// Comment blocks. The fixtures need a cwd of their own: the rule reads the
// burn-down allowlist and the changed-file set from the workspace it is
// linting, and a temporary directory is the only way to state both.

function lineComments(lines) {
  return Array.from({ length: lines }, () => "// comment").join("\n");
}

function blockComment(lines) {
  if (lines === 1) return "/* comment */";
  return ["/*", ...Array.from({ length: lines - 2 }, () => " * comment"), " */"].join("\n");
}

function fixtureRoot(prefix) {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

function fixtureTester(root) {
  return new RuleTester({ cwd: root, languageOptions: { sourceType: "module" } });
}

const looseRoot = fixtureRoot("comment-block-loose-");
const looseTester = fixtureTester(looseRoot);
const longCommentLine = `// ${"long".repeat(30)}`;

looseTester.run("comment-block-size", plugin.rules["comment-block-size"], {
  valid: [
    { filename: "src/five.ts", code: blockComment(5) },
    { filename: "src/code.ts", code: lineComments(3) },
    {
      filename: "src/separated.ts",
      code: `${lineComments(5)}\n\n${lineComments(5)}`,
    },
    {
      filename: "src/trailing.ts",
      code: Array.from({ length: 9 }, (_, index) => `const value${index} = 1; // comment`).join(
        "\n",
      ),
    },
    {
      filename: "src/scenario.ts",
      code: [
        "/**",
        ' * @scenario "A definition map becomes a JSON Schema object"',
        " * Extra line one.",
        " * Extra line two.",
        " * Extra line three.",
        " * Extra line four.",
        " * Extra line five.",
        " * Extra line six.",
        " */",
      ].join("\n"),
    },
    {
      filename: "src/directives.ts",
      code: [
        "// eslint-disable-next-line no-console",
        "// oxlint-disable-next-line no-unused-vars",
        "// @ts-expect-error legacy shape",
        "// eslint-disable-next-line max-len",
        "// oxlint-disable-next-line no-empty",
        "// @ts-ignore third-party types",
        "// eslint-disable-next-line no-shadow",
        "// oxlint-disable-next-line no-void",
        "// @ts-expect-error second legacy shape",
        "export const value = 1;",
      ].join("\n"),
    },
    {
      filename: "src/licensed.ts",
      code: `// SPDX-License-Identifier: Apache-2.0\n${lineComments(9)}`,
    },
    {
      filename: "src/generated-header.ts",
      code: `// Code generated by test. DO NOT EDIT.\n${lineComments(9)}`,
    },
    { filename: "src/schema.generated.ts", code: lineComments(9) },
    { filename: "dist/build.ts", code: lineComments(9) },
  ],
  invalid: [
    {
      filename: "src/nine.ts",
      code: blockComment(9),
      errors: [
        {
          message: commentBlockSizeMessage(9),
        },
      ],
    },
    {
      filename: "apps/api/src/app/example.composition.ts",
      code: blockComment(12),
      errors: [
        {
          message: commentBlockSizeMessage(12),
        },
      ],
    },
    {
      filename: "src/wide.ts",
      code: `${longCommentLine}\nexport const value = 1;`,
      errors: [{ messageId: "commentColumns" }],
    },
  ],
});

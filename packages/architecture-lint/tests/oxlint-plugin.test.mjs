import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commentBlockSizeMessage } from "@langwatch/lint-core/grammar/comment-block-policy.mjs";
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
      filename: "modules/agent/server/src/repositories/prisma/example.ts",
      code: 'import type { PrismaClient } from "@prisma/client"; export type Db = PrismaClient;',
    },
    {
      filename: "apps/api/src/tasks/migrate-agent.ts",
      code: 'import { AgentMigration } from "@langwatch/agent-server"; export { AgentMigration };',
    },
    {
      filename: "apps/worker/src/example.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
    {
      filename: "apps/tasks/src/example.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
    {
      filename: "enterprise/packages/composition/api/src/example.ts",
      code: 'import { GovernanceService } from "@langwatch/enterprise-governance-server"; export { GovernanceService };',
    },
    {
      filename: "apps/api/src/features/evaluation/__tests__/evaluation-trpc.mount.unit.test.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
    {
      filename: "apps/worker/src/app/__tests__/worker-durable.composition.unit.test.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
    {
      filename: "enterprise/packages/composition/worker/tests/wiring.unit.test.ts",
      code: 'import { GovernanceService } from "@langwatch/enterprise-governance-server"; export { GovernanceService };',
    },
    {
      filename: "modules/project/server/tests/agent.integration.test.ts",
      code: 'import { fixture } from "@langwatch/agent-server/testing"; export { fixture };',
    },
  ],
  invalid: [
    {
      filename: "modules/agent/contract/src/example.ts",
      code: 'import React from "react"; export { React };',
      errors: [{ messageId: "contractRuntime" }],
    },
    {
      filename: "modules/agent/server/src/example.ts",
      code: 'import type { ReactNode } from "react"; export type Value = ReactNode;',
      errors: [{ messageId: "serverImportsBrowser" }],
    },
    {
      filename: "mcp/typescript/src/example.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "mcp/typescript/src/example.ts",
      code: 'import { fixture } from "@langwatch/agent-server/testing"; export { fixture };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "mcp/typescript/src/__tests__/agent.integration.test.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "mcp/typescript/scripts/__tests__/agent.integration.test.ts",
      code: 'import { fixture } from "@langwatch/agent-server/testing"; export { fixture };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "mcp/typescript/prisma/__tests__/agent.integration.test.ts",
      code: 'import { fixture } from "@langwatch/agent-server/testing"; export { fixture };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "modules/agent/contract/src/example.ts",
      code: 'export { AgentService } from "../../server/src";',
      errors: [{ messageId: "packageEscape" }],
    },
    {
      filename: "modules/entitlement/contract/src/example.ts",
      code: 'export { Agent } from "@langwatch/agent-contract/private";',
      errors: [{ messageId: "sealedExports" }],
    },
    {
      filename: "modules/agent/server/src/services/example.ts",
      code: 'import type { PrismaClient } from "@prisma/client"; export type Db = PrismaClient;',
      errors: [{ messageId: "prismaContainment" }],
    },
    {
      filename: "modules/agent/server/src/example.ts",
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
      filename: "modules/agent/server/src/example.ts",
      code: 'import { resolver } from "hono-openapi/zod"; export { resolver };',
      errors: [{ messageId: "schemaBoundary" }],
    },
    {
      filename: "modules/agent/server/src/api/internal/agent.api.ts",
      code: 'import type { AgentRepository } from "../../repositories/agent.repository"; export type Value = AgentRepository;',
      errors: [{ messageId: "featureLayer" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'import type { AgentApi } from "../api/internal/agent.api"; export type Value = AgentApi;',
      errors: [{ messageId: "featureLayer" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'import { PrismaAgentRepository } from "../repositories/prisma/prisma.agent.repository"; export { PrismaAgentRepository };',
      errors: [{ messageId: "featureLayer" }],
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
      filename: "apps/api/src/platform/config/api.config.ts",
      code: "export const value = process.env.APPLICATION_VALUE;",
    },
    {
      filename: "apps/worker/src/platform/config/worker.config.ts",
      code: "export const value = import.meta.env.APPLICATION_VALUE;",
    },
    {
      filename: "packages/architecture-lint/tests/environment.test.ts",
      code: "export const value = process.env.TEST_VALUE;",
    },
    {
      filename: "packages/redaction/src/__bench__/secrets.bench.ts",
      code: "export const value = process.env.BENCHMARK_VALUE;",
    },
    {
      filename: "modules/agent/server/src/testing/runtime.spec.ts",
      code: "export const value = process.env.TEST_VALUE;",
    },
    {
      filename: "packages/eventing/src/probe.ts",
      code: 'const env = "not-env"; export const value = process[env];',
    },
    {
      // Booting the process is where a typed value gets parsed.
      filename: "apps/api/src/app/api-standalone.executable.ts",
      code: "export const value = process.env.PORT;",
    },
    {
      filename: "apps/worker/src/app/worker-production.composition.ts",
      code: "export const value = process.env.REDIS_URL;",
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
      filename: "modules/agent/server/src/config.ts",
      code: "export const value = process[`env`].AGENT_KEY;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "modules/agent/server/src/config.ts",
      code: 'export const value = process["e" + "nv"].AGENT_KEY;',
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "packages/observability/src/logger.ts",
      code: 'export const value = import.meta["env"].LOG_LEVEL;',
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "modules/agent/server/src/runtime.unit.helper.ts",
      code: "export const value = process.env.AGENT_KEY;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "packages/architecture-lint/src/example.ts",
      code: "export const value = process.env.LINT_MODE;",
      errors: [{ messageId: "environment" }],
    },
  ],
});

/** @scenario "LangWatch house rules keep executable fixtures" */
/** @scenario "Behaviour-bearing modules are classes" */
tester.run("feature-module-classes", plugin.rules["feature-module-classes"], {
  valid: [
    {
      filename: "modules/agent/contract/src/agent.service.ts",
      code: "export abstract class AgentService {}",
    },
    {
      filename: "modules/agent/server/src/repositories/agent.repository.ts",
      code: "export abstract class AgentRepository {}",
    },
    {
      filename: "modules/api-key/server/src/ports/credential.port.ts",
      code: "export type CredentialId = string; export abstract class CredentialPort { abstract load(id: CredentialId): Promise<void>; }",
    },
    {
      filename: "modules/automation/server/src/ports/automation-graph.port.ts",
      code: "export abstract class AutomationGraphNotifierPort { abstract dispatch(): Promise<void>; }",
    },
    {
      filename: "modules/agent/server/src/repositories/prisma/prisma.agent.repository.ts",
      code: "export class PrismaAgentRepository { static create() { return new PrismaAgentRepository(); } }",
    },
    {
      filename: "modules/agent/server/src/api/internal/agent.api.ts",
      code: "export class AgentApi { static create() { return new AgentApi(); } }",
    },
  ],
  invalid: [
    {
      filename: "modules/agent/contract/src/agent.service.ts",
      code: "export interface AgentService {}",
      errors: [{ messageId: "abstract" }],
    },
    {
      filename: "modules/agent/server/src/projections/agent.projection.ts",
      code: "export class AgentProjection {}",
      errors: [{ messageId: "create" }],
    },
    {
      filename: "modules/agent/server/src/api/internal/agent.api.ts",
      code: "export function createAgentApi() { return {}; }",
      errors: [{ messageId: "concrete" }, { messageId: "standalone" }],
    },
    {
      filename: "modules/agent/server/src/api/internal/agent.api.ts",
      code: "class AgentApi { static create() { return new AgentApi(); } }",
      errors: [{ messageId: "concrete" }],
    },
    {
      filename: "modules/api-key/server/src/ports/credential.port.ts",
      code: "export type CredentialPort = { load(id: string): Promise<void>; };",
      errors: [{ messageId: "abstract" }],
    },
    {
      filename: "modules/api-key/server/src/ports/credential.port.ts",
      code: "export abstract class CredentialPort { abstract load(id: string): Promise<void>; } export type LegacyCredentialPort = { load(id: string): Promise<void>; };",
      errors: [{ messageId: "abstract" }],
    },
  ],
});

/** @scenario "Feature services are classes" */
/** @scenario "Feature classes may use private pure helpers" */
tester.run("service-classes", plugin.rules["service-classes"], {
  valid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "function normalise() { return true; } export class AgentService { static create() { normalise(); return new AgentService(); } private constructor() {} }",
    },
  ],
  invalid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function createAgentService() { return {}; }",
      errors: [{ messageId: "missing" }, { messageId: "standalone" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {}",
      errors: [{ messageId: "create" }],
    },
  ],
});

tester.run("service-quality", plugin.rules["service-quality"], {
  valid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nstatic create() {\nreturn new AgentService();\n}\nprivate constructor() {}\nasync run() {\nconst value = await Promise.resolve(true);\nreturn value;\n}\n}",
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'export class AgentService {\nstatic create() {\nreturn new AgentService();\n}\nprivate constructor() {}\n["literal"]() {\nreturn true;\n}\n}',
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nstatic create() {\nreturn new AgentService();\n}\nprivate constructor() {}\noverload(input: string): string;\noverload(input: number): string;\noverload(input: string | number) {\nreturn String(input);\n}\n}",
    },
  ],
  invalid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nstatic create() { return new AgentService(); }\nconstructor() {}\nrun() { return { repeated: 1, repeated: 2 }; }\n}",
      errors: [{ messageId: "publicConstructor" }, { messageId: "duplicateObjectKey" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'export class AgentService {\nstatic create() {\nreturn new AgentService();\n}\nprivate constructor() {}\nrun() {\nreturn { ["repeated"]: 1, ["repeated"]: 2 };\n}\n}',
      errors: [{ messageId: "duplicateObjectKey" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'export class AgentService {\nstatic create() { return new AgentService(); }\nprivate constructor() {}\noverload(input: string): string;\noverload(input: number): string;\noverload(input: string | number) { return String(input); }\noverload = () => "invalid second implementation";\n}',
      languageOptions: { parserOptions: { ignoreNonFatalErrors: true } },
      errors: [{ messageId: "duplicateMember" }],
    },
  ],
});

tester.run("max-statements-per-line", plugin.rules["max-statements-per-line"], {
  valid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nstatic create() { return new AgentService(); }\nprivate constructor() {}\nrun() { return true; }\noverload(input: string): string;\noverload(input: number): string;\noverload(input: string | number) {\nreturn String(input);\n}\n}",
    },
  ],
  invalid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nstatic create() { return new AgentService(); }\nprivate constructor() {}\nrun() {\nconst first = 1; const second = 2;\nreturn first + second;\n}\n}",
      errors: [{ messageId: "maxStatementsPerLine" }],
    },
  ],
});

tester.run("service-member-spacing", plugin.rules["service-member-spacing"], {
  valid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nfirst() {}\n\n// This belongs to the following method.\nsecond() {}\n}",
    },
  ],
  invalid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nfirst() {}\nsecond() {}\n}",
      output: "export class AgentService {\nfirst() {}\n\nsecond() {}\n}",
      errors: [{ messageId: "memberSpacing" }],
    },
  ],
});

/** @scenario "API handlers use the composed request context" */
tester.run("api-context-services", plugin.rules["api-context-services"], {
  valid: [
    {
      filename: "modules/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { async handle(context, input) { await context.authorize(input.permission); return context.app.agents.create({ ...input, actorId: context.actor().id }); } }",
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export class AgentService { constructor(repository) { this.repository = repository; } }",
    },
  ],
  invalid: [
    {
      filename: "modules/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(context) { return this.options.service(context).list(); } }",
      errors: [{ messageId: "resolver" }],
    },
    {
      filename: "modules/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(context) { return this.options.projectId(context); } }",
      errors: [{ messageId: "resolver" }],
    },
    {
      filename: "modules/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(input) { return this.options.loadService(input.projectId).list(); } }",
      errors: [{ messageId: "resolver" }],
    },
    {
      filename: "modules/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(context) { return (context as Context).app.agents.list(); } }",
      errors: [{ messageId: "contextCast" }],
    },
    {
      filename: "modules/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle() { return new AgentService(); } }",
      errors: [{ messageId: "construction" }],
    },
    {
      filename: "modules/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { async handle(context) { return await (await loadAgentService(context)).list(); } }",
      errors: [{ messageId: "doubleAwait" }],
    },
  ],
});

/** @scenario "Services do not reach through another domain's repository" */
/** @scenario "Service dependencies are explicit domain capabilities" */
tester.run("service-dependencies", plugin.rules["service-dependencies"], {
  valid: [
    {
      filename: "apps/api/src/services/organization.service.ts",
      code: 'import type { OrganizationRepository } from "./repositories/organization.repository"; import type { PromptTagService } from "../../prompt-config/prompt-tag.service"; export class OrganizationService {}',
    },
    {
      filename: "modules/organization/server/src/services/organization.service.ts",
      code: 'import type { OrganizationRepository } from "../repositories/organization.repository"; import type { ProjectService } from "@langwatch/project-contract"; export class OrganizationService {}',
    },
  ],
  invalid: [
    {
      filename: "apps/api/src/services/organization.service.ts",
      code: 'import type { PromptTagRepository } from "../../prompt-config/repositories/prompt-tag.repository"; export class OrganizationService {}',
      errors: [{ messageId: "foreignRepository" }],
    },
    {
      filename: "apps/api/src/services/organization.service.ts",
      code: 'import type { PromptTagRepository } from "../../prompt-config"; export class OrganizationService {}',
      errors: [{ messageId: "foreignRepository" }],
    },
    {
      filename: "modules/organization/server/src/services/organization.service.ts",
      code: 'import type { ProjectRepository } from "@langwatch/project-server"; export class OrganizationService {}',
      errors: [{ messageId: "foreignRepository" }],
    },
    {
      filename: "apps/api/src/services/organization.service.ts",
      code: 'import { getApp } from "../app"; export class OrganizationService { run() { return getApp().projects; } }',
      errors: [{ messageId: "globalApplication" }],
    },
    {
      filename: "apps/api/src/services/organization.service.ts",
      code: 'import type { PrismaClient } from "~/generated/prisma/client"; export class OrganizationService { constructor(readonly prisma: PrismaClient) {} }',
      errors: [{ messageId: "databaseClient" }],
    },
  ],
});

// "runtime-undefined" was deleted under ADR-135's class-A migration; the
// built-in no-undefined that replaced it needs no fixture here, since oxlint
// tests its own built-ins.

tester.run("logical-statement-spacing", plugin.rules["logical-statement-spacing"], {
  valid: [
    {
      filename: "modules/agent/server/src/example.ts",
      code: `function run() {
  if (ready) {
    start();
  }

  // Keep this explanatory comment with the next operation.
  finish();

  return true;
}`,
    },
    {
      filename: "modules/agent/server/src/example.ts",
      code: `function run() {
  if (ready) finish();
  else wait();

  try {
    work();
  } catch {
    recover();
  } finally {
    cleanup();
  }
}`,
    },
    {
      filename: "modules/agent/server/src/example.ts",
      code: `function run() {
  return true;
}`,
    },
  ],
  invalid: [
    {
      filename: "modules/agent/server/src/example.ts",
      code: `function run() {
  if (ready) {
    start();
  }
  // Preserve this comment.
  finish();
  return true;
}`,
      output: `function run() {
  if (ready) {
    start();
  }

  // Preserve this comment.
  finish();

  return true;
}`,
      errors: [{ messageId: "statementSpacing" }, { messageId: "statementSpacing" }],
    },
    {
      filename: "modules/agent/server/src/example.ts",
      code: "function run() { if (ready) { start(); } finish(); }",
      output: "function run() { if (ready) { start(); }\n\n finish(); }",
      errors: [{ messageId: "statementSpacing" }],
    },
    {
      filename: "modules/agent/server/src/example.ts",
      code: `function run() {
  if (ready) {
    start();
  } // Keep this trailing comment attached.
  finish();
}`,
      output: `function run() {
  if (ready) {
    start();
  } // Keep this trailing comment attached.

  finish();
}`,
      errors: [{ messageId: "statementSpacing" }],
    },
    {
      filename: "modules/agent/server/src/example.ts",
      code: "function run() {\r\n  try { work(); } catch { recover(); } finally { cleanup(); }\r\n  return true;\r\n}",
      output:
        "function run() {\r\n  try { work(); } catch { recover(); } finally { cleanup(); }\r\n\r\n  return true;\r\n}",
      errors: [{ messageId: "statementSpacing" }],
    },
  ],
});

tester.run("boolean-wall", plugin.rules["boolean-wall"], {
  valid: [
    {
      filename: "packages/architecture-lint/src/feature-catalogue.ts",
      code: "const validName = entry.id === id && entry.root === root; const ordered = left < right; return validName && ordered;",
    },
    {
      filename: "packages/architecture-lint/src/feature-catalogue.ts",
      code: "return first && second && third;",
    },
    {
      filename: "packages/architecture-lint/src/feature-catalogue.ts",
      code: "return (first && second) || third;",
    },
    {
      filename: "packages/architecture-lint/src/feature-catalogue.ts",
      code: "return first ?? second ?? third ?? fourth;",
    },
    {
      filename: "packages/architecture-lint/src/feature-catalogue.ts",
      code: "return first && (second ?? third ?? fourth);",
    },
  ],
  invalid: [
    {
      filename: "packages/architecture-lint/src/feature-catalogue.ts",
      code: `return entry.id === id &&
  entry.root === root &&
  entry.classification === classification &&
  entry.subjects.length > 0;`,
      errors: [{ messageId: "booleanWall" }],
    },
    {
      filename: "packages/architecture-lint/src/feature-catalogue.ts",
      code: "return (first && second) || (third && fourth);",
      errors: [{ messageId: "booleanWall" }],
    },
    {
      filename: "packages/architecture-lint/src/feature-catalogue.ts",
      code: "return (first && second && third && fourth) ?? fallback;",
      errors: [{ messageId: "booleanWall" }],
    },
  ],
});

tester.run("awaited-return-chain", plugin.rules["awaited-return-chain"], {
  valid: [
    {
      filename: "modules/api-key/server/src/services/api-key.service.ts",
      code: "export class ApiKeyService { async run() { return await this.repository.list(); } }",
    },
    {
      filename: "modules/api-key/server/src/services/api-key.service.ts",
      code: "export class ApiKeyService { async run() { return this.repository.list().map((item) => item.id); } }",
    },
  ],
  invalid: [
    {
      filename: "modules/api-key/server/src/services/api-key.service.ts",
      code: "export class ApiKeyService { async run() { return (await this.repository.list()).map((item) => item.id); } }",
      errors: [{ messageId: "awaitedReturnChain" }],
    },
    {
      filename: "modules/api-key/server/src/services/api-key.service.ts",
      code: "export class ApiKeyService { async run() { return (await this.repository.list()).data.items; } }",
      errors: [{ messageId: "awaitedReturnChain" }],
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
      code: 'import { PrismaClient } from "@prisma/client"; export { PrismaClient };',
      errors: [{ messageId: "prismaContainment" }],
    },
    {
      filename: "modules/agent/contract/src/agent.service.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
      errors: [{ messageId: "contractRuntime" }],
    },
    {
      filename: "modules/agent/contract/src/agent.service.ts",
      code: 'import { AgentCard } from "@langwatch/agent-web/screens/agent-management"; export { AgentCard };',
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
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'import type { Agent } from "@langwatch/agent-contract"; export type Value = Agent;',
    },
  ],
  invalid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'import React from "react"; export { React };',
      errors: [{ messageId: "serverImportsBrowser" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'import { Box } from "@chakra-ui/react"; export { Box };',
      errors: [{ messageId: "serverImportsBrowser" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'import { AgentCard } from "@langwatch/agent-web/screens/agent-management"; export { AgentCard };',
      errors: [{ messageId: "serverImportsBrowser" }],
    },
  ],
});

/** @scenario "Only composition roots import feature server installers" */
tester.run("package-boundaries: server installers", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "apps/api/src/app/api-production.composition.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
    {
      filename: "apps/worker/src/app/worker.composition.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
    {
      filename: "enterprise/packages/composition/api/src/enterprise-api.composition.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
  ],
  invalid: [
    {
      filename: "apps/ui/src/features/agent/ui/agent-list.tsx",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "sdks/typescript/src/example.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
      errors: [{ messageId: "compositionRoot" }],
    },
  ],
});

/** @scenario "A composition root's own tests import what the root imports" */
tester.run("package-boundaries: composition root tests", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "apps/api/src/app/__tests__/api-production.composition.unit.test.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
    {
      filename: "enterprise/packages/composition/api/tests/wiring.unit.test.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
  ],
  invalid: [
    {
      filename: "sdks/typescript/src/__tests__/agent.unit.test.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
      errors: [{ messageId: "compositionRoot" }],
    },
  ],
});

/** @scenario "A relative import cannot escape its physical package" */
tester.run("package-boundaries: package escape", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'import type { AgentRepository } from "../repositories/agent.repository"; export type Value = AgentRepository;',
    },
  ],
  invalid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'import type { Agent } from "../../../contract/src/agent.service"; export type Value = Agent;',
      errors: [{ messageId: "packageEscape" }],
    },
  ],
});

/** @scenario "An undeclared package subpath is not importable" */
tester.run("package-boundaries: sealed exports", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "modules/prompt/web/src/prompt-list.tsx",
      code: 'import type { Agent } from "@langwatch/agent-contract"; export type Value = Agent;',
    },
  ],
  invalid: [
    {
      filename: "modules/prompt/web/src/prompt-list.tsx",
      code: 'import type { Agent } from "@langwatch/agent-contract/src/agent.service"; export type Value = Agent;',
      errors: [{ messageId: "sealedExports" }],
    },
  ],
});

/** @scenario "Internal server dependencies point toward the service contract" */
tester.run("package-boundaries: feature layer direction", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "modules/agent/server/src/api/public/agent.api.ts",
      code: 'import type { AgentService } from "../../services/agent.service"; export type Value = AgentService;',
    },
  ],
  invalid: [
    {
      filename: "modules/agent/server/src/api/public/agent.api.ts",
      code: 'import type { AgentRepository } from "../../repositories/agent.repository"; export type Value = AgentRepository;',
      errors: [{ messageId: "featureLayer" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'import type { AgentApi } from "../api/public/agent.api"; export type Value = AgentApi;',
      errors: [{ messageId: "featureLayer" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: 'import { PrismaAgentRepository } from "../repositories/prisma/prisma.agent.repository"; export { PrismaAgentRepository };',
      errors: [{ messageId: "featureLayer" }],
    },
  ],
});

/** @scenario "A web feature collaborates only through another web feature's named surface" */
tester.run("package-boundaries: web feature surfaces", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "modules/prompt/web/src/ui/elements/browser-panel.tsx",
      code: 'import { BrowserPort } from "@langwatch/agent-web/surfaces/browser-port"; export { BrowserPort };',
    },
    {
      filename: "enterprise/modules/billing/web/src/ui/elements/scope-row.tsx",
      code: 'import { ScopePicker } from "@langwatch/authz-web/surfaces/scope-picker"; export { ScopePicker };',
    },
    {
      filename: "apps/ui/src/routes/agents.tsx",
      code: 'import { AgentManagementScreen } from "@langwatch/agent-web/screens/agent-management"; export { AgentManagementScreen };',
    },
  ],
  invalid: [
    {
      filename: "modules/prompt/web/src/ui/elements/briefing.tsx",
      code: 'import { Langy } from "@langwatch/langy-web"; export { Langy };',
      errors: [{ messageId: "crossFeature" }],
    },
    {
      filename: "modules/prompt/web/src/ui/elements/briefing.tsx",
      code: 'import { TraceDrawers } from "@langwatch/trace-web/drawers"; export { TraceDrawers };',
      errors: [{ messageId: "crossFeature" }],
    },
    {
      filename: "modules/prompt/web/src/ui/elements/agents.tsx",
      code: 'import { AgentManagementScreen } from "@langwatch/agent-web/screens/agent-management"; export { AgentManagementScreen };',
      errors: [{ messageId: "crossFeature" }],
    },
  ],
});

/** @scenario "A web package's test seam is reachable from a test source" */
tester.run("package-boundaries: web test seam", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename:
        "modules/scenario/web/src/behavior/suites/__tests__/cancel-button.integration.test.tsx",
      code: 'import { makeScenarioRunData } from "@langwatch/suite-web/testing"; export { makeScenarioRunData };',
    },
    {
      filename: "apps/ui/src/features/simulations/__tests__/runs.integration.test.tsx",
      code: 'import { makeScenarioRunData } from "@langwatch/suite-web/testing"; export { makeScenarioRunData };',
    },
  ],
  invalid: [
    {
      filename: "modules/scenario/web/src/behavior/suites/run-history.ts",
      code: 'import { makeScenarioRunData } from "@langwatch/suite-web/testing"; export { makeScenarioRunData };',
      errors: [{ messageId: "crossFeature" }],
    },
  ],
});

tester.run("cognitive-complexity", plugin.rules["cognitive-complexity"], {
  valid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function classify(a, b, c) { if (a) { return 1; } if (b) { return 2; } if (c) { return 3; } return 0; }",
      options: [{ max: 3 }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export const pick = (a, b) => (a ? 1 : b ? 2 : 3);",
      options: [{ max: 3 }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function outer(items) { return items.map((item) => { if (item) { return 1; } return 0; }); }",
      options: [{ max: 2 }],
    },
  ],
  invalid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function classify(a, b, c) { if (a) { return 1; } if (b) { return 2; } if (c) { return 3; } return 0; }",
      options: [{ max: 2 }],
      errors: [{ messageId: "tooComplex" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function nested(a, b, c) { if (a) { for (const x of b) { while (c) { c = false; } } } }",
      options: [{ max: 5 }],
      errors: [{ messageId: "tooComplex" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function chain(a, b, c, d, e) { if (a && b && c || d || e) { return 1; } return 0; }",
      options: [{ max: 2 }],
      errors: [{ messageId: "tooComplex" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function ternary(a) { return a ? (a ? 1 : 2) : 3; }",
      options: [{ max: 2 }],
      errors: [{ messageId: "tooComplex" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function loopWithArrow(items) { for (const item of items) { items.map((value) => (value ? 1 : 2)); } }",
      options: [{ max: 3 }],
      errors: [{ messageId: "tooComplex" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function countdown(n) { if (n > 0) { return countdown(n - 1); } return 0; }",
      options: [{ max: 1 }],
      errors: [{ messageId: "tooComplex" }],
    },
  ],
});

tester.run("condition-shape", plugin.rules["condition-shape"], {
  valid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function guard(input) { if (!input.id) { return null; } return input; }",
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function ready(state) { if (state.loaded && state.visible) { return true; } return false; }",
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function pick(state) { return state.enabled ? 1 : 0; }",
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function scan(rows) { while (rows.length) { rows.pop(); } }",
    },
  ],
  invalid: [
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function deep(input) { if (input.meta.owner.name) { return 1; } return 0; }",
      errors: [{ messageId: "nameCondition" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function optional(input) { if (input?.meta?.owner?.name) { return 1; } return 0; }",
      errors: [{ messageId: "nameCondition" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function calls(a, b) { if (first(a) && second(b)) { return 1; } return 0; }",
      errors: [{ messageId: "nameCondition" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function operators(a, b, c, d) { if (a && b || c && d) { return 1; } return 0; }",
      errors: [{ messageId: "nameCondition" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function nestedTernary(a, b) { return (a ? b : !b) ? 1 : 0; }",
      errors: [{ messageId: "nameCondition" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function loop(rows, index) { while (rows.at(index).children.length) { index += 1; } }",
      errors: [{ messageId: "nameCondition" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function branch(input) { switch (input.meta.owner.kind) { default: return 0; } }",
      errors: [{ messageId: "nameCondition" }],
    },
    {
      filename: "modules/agent/server/src/services/agent.service.ts",
      code: "export function loosened(a, b, c) { if (a && b && c) { return 1; } return 0; }",
      options: [{ maxOperators: 1 }],
      errors: [{ messageId: "nameCondition" }],
    },
  ],
});

// ---------------------------------------------------------------------------
// Policies that moved out of the architecture-lint CLI, so a reader sees them
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
      filename: "modules/project/server/src/services/project.service.ts",
      code: "export class ProjectService { getById(): Promise<string> { return Promise.resolve('project'); } private map(row: string | null): string | null { return row; } }",
    },
    {
      filename: "modules/project/server/src/app/project.app.ts",
      code: "export class ProjectApp { findById() { return null; } }",
    },
  ],
  invalid: [
    {
      filename: "modules/project/contract/src/project.service.ts",
      code: "export abstract class ProjectService { abstract findById(): Promise<string | null>; }",
      errors: [{ messageId: "untriedAbsence" }],
    },
    {
      filename: "modules/project/contract/src/project.service.ts",
      code: "export abstract class ProjectService { abstract requireById(): Promise<string>; }",
      errors: [{ messageId: "requirePrefix" }],
    },
    {
      filename: "modules/project/contract/src/project.service.ts",
      code: "export abstract class ProjectService { abstract tryGetById(): Promise<string>; }",
      errors: [{ messageId: "tryWithoutAbsence" }],
    },
    {
      filename: "modules/project/server/src/services/project.service.ts",
      code: "export class ProjectService { requireById() { return 'project'; } tryGetById() { return null; } }",
      errors: [
        { messageId: "requirePrefix" },
        { messageId: "noResultType" },
        { messageId: "noResultType" },
      ],
    },
    {
      filename: "modules/project/server/src/ports/project.port.ts",
      code: "export abstract class ProjectRepositoryPort { abstract findById(): Promise<string | null>; }",
      errors: [{ messageId: "untriedAbsence" }],
    },
  ],
});

tester.run("feature-source-filename", plugin.rules["feature-source-filename"], {
  valid: [
    {
      filename: "modules/project/server/src/services/project.service.ts",
      code: "export const value = 1;",
    },
    {
      filename: "modules/project/server/src/repositories/prisma/prisma.project.repository.ts",
      code: "export const value = 1;",
    },
    {
      filename: "modules/project/server/src/services/__tests__/projectService.unit.test.ts",
      code: "export const value = 1;",
    },
  ],
  invalid: [
    {
      filename: "modules/project/server/src/services/projectService.service.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "filename" }],
    },
    {
      filename: "modules/project/web/src/ui/ProjectPanel.tsx",
      code: "export const value = 1;",
      errors: [{ messageId: "filename" }],
    },
    {
      filename: "modules/project/server/src/repositories/prisma-project.repository.ts",
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
      filename: "modules/project/server/src/transport/api-rest/project.api.ts",
      code: "export const value = 1;",
    },
    {
      filename: "modules/project/server/src/rules/project.rules.ts",
      code: "export const registry = new Map<string, string>();",
    },
    {
      filename: "modules/project/server/src/services/__tests__/project.unit.test.ts",
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
      filename: "modules/project/contract/src/project.port.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "contractServerArtifact" }],
    },
    {
      filename: "modules/project/server/src/helpers/project-helper.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "serverPath" }],
    },
    {
      // A test outside a `__tests__` directory is still a server source path.
      filename: "modules/project/server/src/services/project.service.unit.test.ts",
      code: "export const covered = true;",
      errors: [{ messageId: "serverPath" }],
    },
    {
      filename: "modules/project/server/src/repositories/prisma/prisma.project.extra.repository.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "serverPath" }],
    },
    {
      filename: "modules/project/server/src/services/project-process.service.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "processManagerService" }],
    },
    {
      filename: "modules/project/server/src/rules/project.rules.ts",
      code: "export class ProjectRules {}",
      errors: [{ messageId: "rulesImpurity" }],
    },
    {
      filename: "modules/project/server/src/rules/project.rules.ts",
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
      filename: "modules/project/server/src/services/project.service.ts",
      code: "export const value = 1;",
    },
    {
      filename: "modules/project/server/src/index.ts",
      code: "export const value = 1;",
    },
    {
      filename: "modules/project/server/src/ports/notification.port.ts",
      code: "export const value = 1;",
    },
  ],
  invalid: [
    {
      filename: "modules/project/server/src/services/notification.service.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "foreignSubject" }],
    },
    {
      filename: "modules/evaluator/server/src/adapters/prisma.audit-log.adapter.ts",
      code: "export const value = 1;",
      errors: [{ messageId: "foreignSubject" }],
    },
  ],
});

tester.run("prisma-containment", plugin.rules["prisma-containment"], {
  valid: [
    {
      filename: "modules/project/server/src/repositories/prisma/prisma.project.repository.ts",
      code: "import { PrismaClient } from '@langwatch/prisma-client/generated'; export type Db = PrismaClient;",
    },
    {
      filename: "modules/project/server/src/adapters/postgres.project.adapter.ts",
      code: "import { PrismaClient } from '@langwatch/prisma-client/generated'; export type Db = PrismaClient;",
    },
    {
      filename: "apps/api/src/app/api-production.composition.ts",
      code: "import { prisma } from '@langwatch/prisma-client'; export { prisma };",
    },
    {
      filename: "apps/api/src/features/project/project.mount.ts",
      code: "import { PrismaClient } from '@langwatch/prisma-client/generated'; export type Db = PrismaClient;",
    },
  ],
  invalid: [
    {
      filename: "modules/project/server/src/services/project.service.ts",
      code: "import { PrismaClient } from '@langwatch/prisma-client/generated'; export type Db = PrismaClient;",
      errors: [{ messageId: "generatedPrisma" }],
    },
    {
      filename: "modules/project/contract/src/project.service.ts",
      code: "export { PrismaClient } from '@langwatch/prisma-client/generated';",
      errors: [{ messageId: "generatedPrisma" }],
    },
    {
      filename: "modules/project/server/src/services/project.service.ts",
      code: "import { prisma } from '@langwatch/prisma-client'; export { prisma };",
      errors: [{ messageId: "featurePrismaClient" }],
    },
    {
      filename: "apps/api/src/services/project-reader.ts",
      code: "import { PrismaClient } from '@langwatch/prisma-client/generated'; export type Db = PrismaClient;",
      errors: [{ messageId: "generatedPrisma" }],
    },
  ],
});

tester.run("typed-prisma-seam", plugin.rules["typed-prisma-seam"], {
  valid: [
    {
      filename: "modules/project/server/src/repositories/prisma/prisma.project.repository.ts",
      code: "export class R { static create(prisma: PrismaClient) { return new R(prisma); } }",
    },
    {
      filename: "modules/project/server/src/services/project.service.ts",
      code: "export const db = client as PrismaClient;",
    },
    {
      // Already on the shrink-only baseline, so the sweep owns it, not the run.
      filename: "modules/automation/server/src/adapters/postgres.automation.adapter.ts",
      code: "export const db = client as PrismaClient;",
    },
  ],
  invalid: [
    {
      filename: "modules/project/server/src/repositories/prisma/prisma.project.repository.ts",
      code: "export const db = client as PrismaClient;",
      errors: [{ messageId: "cast" }],
    },
    {
      filename: "modules/project/server/src/adapters/postgres.project.adapter.ts",
      code: "export class A { static create(database: object) { return new A(); } }",
      errors: [{ messageId: "databaseObject" }],
    },
  ],
});

/** @scenario "The raw Hono app cannot be mounted around the policy" */
tester.run("no-raw-hono-mount", plugin.rules["no-raw-hono-mount"], {
  valid: [
    {
      filename: "apps/api/src/features/health/health-probe-rest.ts",
      code: 'export const app = secured.access(policy).get("/healthz", handler);',
    },
    {
      filename: "apps/api/src/features/health/health-probe-rest.ts",
      code: "export const mounted = secured.mountInto(parent);",
    },
    {
      // Serving a request through the composed app registers nothing.
      filename: "modules/monitor/server/src/app/__tests__/monitor.transport.unit.test.ts",
      code: 'export const response = app.hono.request("/api/monitors");',
    },
    {
      filename: "tools/thuishaven/example.ts",
      code: 'export const smuggled = app.hono.get("/bypass", handler);',
    },
  ],
  invalid: [
    {
      filename: "apps/api/src/features/health/health-probe-rest.ts",
      code: 'export const smuggled = app.hono.get("/bypass", handler);',
      errors: [{ messageId: "rawMount" }],
    },
    {
      filename: "packages/api/src/rest/example.ts",
      code: 'export const smuggled = secured.hono.post("/bypass", handler);',
      errors: [{ messageId: "rawMount" }],
    },
    {
      filename: "apps/api/src/features/health/health-probe-rest.ts",
      code: 'app.hono.use("/api/*", middleware);\napp.hono.on("HEAD", "/x", handler);\n',
      errors: [{ messageId: "rawMount" }, { messageId: "rawMount" }],
    },
  ],
});

const layerFilename = "modules/project/server/src/services/example.service.ts";

tester.run("layer-class", plugin.rules["layer-class"], {
  valid: [
    {
      // An anti-corruption layer converts on the way through, so deleting it
      // would move the conversion to every caller.
      filename: layerFilename,
      code: `export class ExampleAdapter {
  a(input: In): Out { return this.inner.a(this.toInner(input)); }
  b(input: In): Out { return this.inner.b(this.toInner(input)); }
  c(input: In): Out { return this.inner.c(this.toInner(input)); }
  d(input: In): Out { return this.inner.d(this.toInner(input)); }
  e(input: In): Out { return this.inner.e(this.toInner(input)); }
}`,
    },
    {
      filename: layerFilename,
      code: `export class ExampleService {
  a(input: In): Out { this.guard(input); return this.inner.a(input); }
  b(input: In): Out { return this.inner.findB(input); }
  c(input: In): Out { return this.inner.c(input); }
  d(input: In): Out { return transform(this.inner.d(input)); }
  e(input: In): Out { return this.inner.e(input); }
}`,
    },
    {
      filename: layerFilename,
      code: `export class ExampleService {
  a(input: In): Out { return this.policy.a(input); }
  b(input: In): Out { return this.catalog.b(input); }
  c(input: In): Out { return this.lifecycle.c(input); }
  d(input: In): Out { return this.tokens.d(input); }
  e(input: In): Out { return this.visibility.e(input); }
}`,
    },
    {
      filename: layerFilename,
      code: `export class ExampleService {
  private constructor(private readonly repository: ExampleRepository) {}
  a(input: In): Out { return this.repository.a(input); }
  b(input: In): Out { return this.repository.b(input); }
  c(input: In): Out { return this.repository.c(input); }
  d(input: In): Out { return this.repository.d(input); }
  e(input: In): Out { return this.repository.e(input); }
}`,
    },
    {
      filename: "modules/project/server/src/app/example.app.ts",
      code: `export class ExampleApp {
  a(input: In): Out { return this.deps.example.a(input); }
  b(input: In): Out { return this.deps.example.b(input); }
  c(input: In): Out { return this.deps.example.c(input); }
  d(input: In): Out { return this.deps.example.d(input); }
  e(input: In): Out { return this.deps.example.e(input); }
}`,
    },
    {
      filename: "modules/project/server/src/repositories/routed/routed.example.repository.ts",
      code: `export class RoutedExampleRepository {
  a(input: In): Out { return this.primary.a(input); }
  b(input: In): Out { return this.primary.b(input); }
  c(input: In): Out { return this.primary.c(input); }
  d(input: In): Out { return this.primary.d(input); }
  e(input: In): Out { return this.primary.e(input); }
}`,
    },
    {
      filename: layerFilename,
      code: `export class ExampleService {
  a(input: In): Out { return this.inner.a(input); }
  b(input: In): Out { return this.inner.b(input); }
}`,
    },
  ],
  invalid: [
    {
      filename: layerFilename,
      code: `export class ExampleService {
  constructor(private readonly inner: Inner) {}
  a(input: In): Out { return this.inner.a(input); }
  b(input: In): Out { return this.inner.b(input); }
  c(input: In): Out { return this.inner.c(input); }
  d(input: In): Out { return this.inner.d(input); }
  e(input: In): Out { return this.inner.e(input); }
}`,
      errors: [
        {
          message:
            "ExampleService forwards 5 of its 5 public methods to a method of the same name on `this.inner`." +
            " Hold the collaborator at the caller and delete the class, or give it the rules that justify it. `app/<feature>.app.ts` and routed repositories are exempt.",
        },
      ],
    },
    {
      filename: layerFilename,
      code: `export class ExampleFacade {
  readonly a: Contract["a"] = (...args) => this.inner.a(...args);
  readonly b: Contract["b"] = (...args) => this.inner.b(...args);
  readonly c: Contract["c"] = (...args) => this.inner.c(...args);
  readonly d: Contract["d"] = (...args) => this.inner.d(...args);
  e = (input: In): Out => this.inner.e(input);
}`,
      errors: 1,
    },
    {
      filename: layerFilename,
      code: `export class ExampleService {
  async a(input: In): Promise<Out> { return await this.deps.inner.a(input); }
  async b(input: In): Promise<Out> { return await this.deps.inner.b(input); }
  async c(input: In): Promise<Out> { return await this.deps.inner.c(input); }
  async d(input: In): Promise<Out> { return await this.deps.inner.d(input); }
  async e(input: In): Promise<Out> { return await this.deps.inner.e(input); }
}`,
      errors: 1,
    },
    {
      filename: layerFilename,
      code: `export class ExampleService {
  private constructor(private readonly catalog: ExampleCatalogService) {}
  a(input: In): Out { return this.catalog.a(input); }
  b(input: In): Out { return this.catalog.b(input); }
  c(input: In): Out { return this.catalog.c(input); }
  d(input: In): Out { return this.catalog.d(input); }
  e(input: In): Out { return this.catalog.e(input); }
}`,
      errors: 1,
    },
  ],
});

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

function writeFixture(root, file, source) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${source}\n`);
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
    { filename: "src/eight.ts", code: blockComment(8) },
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

looseTester.run("comment-block-size-warning", plugin.rules["comment-block-size-warning"], {
  valid: [
    { filename: "src/five.ts", code: blockComment(5) },
    { filename: "src/nine.ts", code: blockComment(9) },
    { filename: "src/three.ts", code: lineComments(3) },
    { filename: "src/wide.ts", code: `${longCommentLine}\nexport const value = 1;` },
  ],
  invalid: [
    {
      filename: "src/six.ts",
      code: blockComment(6),
      errors: [
        {
          message: commentBlockSizeMessage(6),
        },
      ],
    },
    {
      filename: "src/eight.ts",
      code: blockComment(8),
      errors: [
        {
          message: commentBlockSizeMessage(8),
        },
      ],
    },
  ],
});

describe("the comment-block burn-down allowlist", () => {
  function allowlistRoot({ expires }) {
    const root = fixtureRoot("comment-block-allowlist-");
    const git = (...arguments_) =>
      execFileSync("git", ["-C", root, ...arguments_], { stdio: "ignore" });
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Architecture Lint Test");
    git("config", "commit.gpgsign", "false");
    writeFixture(root, "packages/legacy/src/nine.ts", blockComment(9));
    writeFixture(root, "packages/other/src/nine.ts", blockComment(9));
    writeFixture(
      root,
      "packages/architecture-lint/src/comment-block-roots.json",
      JSON.stringify({
        version: 0,
        roots: [{ root: "packages/legacy", blocks: 1, expires }],
      }),
    );
    git("add", ".");
    git("commit", "--quiet", "-m", "baseline");
    return root;
  }

  const liveRoot = allowlistRoot({ expires: "2099-01-01" });
  fixtureTester(liveRoot).run("comment-block-size", plugin.rules["comment-block-size"], {
    valid: [{ filename: "packages/legacy/src/nine.ts", code: blockComment(9) }],
    invalid: [
      {
        filename: "packages/other/src/nine.ts",
        code: blockComment(9),
        errors: [
          {
            message: commentBlockSizeMessage(9),
          },
        ],
      },
    ],
  });

  const expiredRoot = allowlistRoot({ expires: "2020-01-01" });
  fixtureTester(expiredRoot).run("comment-block-size", plugin.rules["comment-block-size"], {
    valid: [],
    invalid: [
      {
        filename: "packages/legacy/src/nine.ts",
        code: blockComment(9),
        errors: [
          {
            message: commentBlockSizeMessage(9),
          },
        ],
      },
    ],
  });
});

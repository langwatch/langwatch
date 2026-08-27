import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

tester.run("package-boundaries", plugin.rules["package-boundaries"], {
  valid: [
    {
      filename: "packages/features/agent/contract/src/example.ts",
      code: 'import { z } from "zod"; export const value = z.string();',
    },
    {
      filename: "packages/features/agent/server/src/repositories/prisma/example.ts",
      code: 'import type { PrismaClient } from "@prisma/client"; export type Db = PrismaClient;',
    },
    {
      filename: "platform/app/src/runtime/app/example.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
    {
      filename: "platform/app/src/tasks/migrate-agent.ts",
      code: 'import { AgentMigration } from "@langwatch/agent-server"; export { AgentMigration };',
    },
    {
      filename: "apps/worker/src/example.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
    {
      filename: "packages/enterprise/composition/api/src/example.ts",
      code: 'import { GovernanceService } from "@langwatch/enterprise-governance-server"; export { GovernanceService };',
    },
    {
      filename: "platform/app/src/server/event-sourcing/registration/pipelineRegistry.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
    },
    {
      filename: "platform/app/src/server/example/__tests__/agent.integration.test.ts",
      code: 'import { fixture } from "@langwatch/agent-server/testing"; export { fixture };',
    },
    {
      filename: "packages/features/project/server/tests/agent.integration.test.ts",
      code: 'import { fixture } from "@langwatch/agent-server/testing"; export { fixture };',
    },
  ],
  invalid: [
    {
      filename: "packages/features/agent/contract/src/example.ts",
      code: 'import React from "react"; export { React };',
      errors: [{ messageId: "packageRole" }],
    },
    {
      filename: "packages/features/agent/server/src/example.ts",
      code: 'import type { ReactNode } from "react"; export type Value = ReactNode;',
      errors: [{ messageId: "packageRole" }],
    },
    {
      filename: "platform/app/src/server/example.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "platform/app/src/server/example.ts",
      code: 'import { fixture } from "@langwatch/agent-server/testing"; export { fixture };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "platform/app/src/server/example/__tests__/agent.integration.test.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "platform/app/scripts/__tests__/agent.integration.test.ts",
      code: 'import { fixture } from "@langwatch/agent-server/testing"; export { fixture };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "platform/app/prisma/__tests__/agent.integration.test.ts",
      code: 'import { fixture } from "@langwatch/agent-server/testing"; export { fixture };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "packages/features/agent/contract/src/example.ts",
      code: 'export { AgentService } from "../../server/src";',
      errors: [{ messageId: "packageEscape" }],
    },
    {
      filename: "packages/features/entitlement/contract/src/example.ts",
      code: 'export { Agent } from "@langwatch/agent-contract/private";',
      errors: [{ messageId: "sealedExports" }],
    },
    {
      filename: "packages/features/agent/server/src/services/example.ts",
      code: 'import type { PrismaClient } from "@prisma/client"; export type Db = PrismaClient;',
      errors: [{ messageId: "prismaContainment" }],
    },
    {
      filename: "packages/features/agent/server/src/example.ts",
      code: 'import { zValidator } from "@hono/zod-validator"; export { zValidator };',
      errors: [{ messageId: "schemaBoundary" }],
    },
    {
      filename: "packages/features/agent/contract/src/example.ts",
      code: 'import { z } from "zod/v3"; export const value = z.string();',
      errors: [{ messageId: "retiredPackageRuntime" }],
    },
    {
      filename: "platform/app/src/server/example.ts",
      code: 'import { cadence } from "@langwatch/automations/cadences"; export { cadence };',
      errors: [{ messageId: "retiredPackageRuntime" }],
    },
    {
      filename: "platform/app/src/server/example.ts",
      code: 'import { service } from "@ee/governance/service"; export { service };',
      errors: [{ messageId: "retiredPackageRuntime" }],
    },
    {
      filename: "packages/features/agent/server/src/example.ts",
      code: 'import { resolver } from "hono-openapi/zod"; export { resolver };',
      errors: [{ messageId: "schemaBoundary" }],
    },
    {
      filename: "packages/features/agent/server/src/api/internal/agent.api.ts",
      code: 'import type { AgentRepository } from "../../repositories/agent.repository"; export type Value = AgentRepository;',
      errors: [{ messageId: "featureLayer" }],
    },
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: 'import type { AgentApi } from "../api/internal/agent.api"; export type Value = AgentApi;',
      errors: [{ messageId: "featureLayer" }],
    },
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: 'import { PrismaAgentRepository } from "../repositories/prisma/prisma.agent.repository"; export { PrismaAgentRepository };',
      errors: [{ messageId: "featureLayer" }],
    },
  ],
});

tester.run("environment-boundaries", plugin.rules["environment-boundaries"], {
  valid: [
    {
      filename: "platform/app/src/server/example.ts",
      code: "export const value = process.env.APPLICATION_VALUE;",
    },
    {
      filename: "packages/features/agent/tests/example.test.ts",
      code: "export const value = process.env.TEST_VALUE;",
    },
  ],
  invalid: [
    {
      filename: "packages/features/agent/contract/src/example.ts",
      code: "export const value = process.env.AGENTS_VALUE;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "packages/config/src/example.ts",
      code: "export const value = import.meta.env.CONFIG_VALUE;",
      errors: [{ messageId: "environment" }],
    },
  ],
});

tester.run("feature-module-classes", plugin.rules["feature-module-classes"], {
  valid: [
    {
      filename: "packages/features/agent/contract/src/agent.service.ts",
      code: "export abstract class AgentService {}",
    },
    {
      filename: "packages/features/agent/server/src/repositories/agent.repository.ts",
      code: "export abstract class AgentRepository {}",
    },
    {
      filename: "packages/features/api-key/server/src/ports/credential.port.ts",
      code: "export type CredentialId = string; export abstract class CredentialPort { abstract load(id: CredentialId): Promise<void>; }",
    },
    {
      filename: "packages/features/automation/server/src/ports/automation-graph.port.ts",
      code: "export abstract class AutomationGraphNotifierPort { abstract dispatch(): Promise<void>; }",
    },
    {
      filename: "packages/features/agent/server/src/repositories/prisma/prisma.agent.repository.ts",
      code: "export class PrismaAgentRepository { static create() { return new PrismaAgentRepository(); } }",
    },
    {
      filename: "packages/features/agent/server/src/api/internal/agent.api.ts",
      code: "export class AgentApi { static create() { return new AgentApi(); } }",
    },
  ],
  invalid: [
    {
      filename: "packages/features/agent/contract/src/agent.service.ts",
      code: "export interface AgentService {}",
      errors: [{ messageId: "abstract" }],
    },
    {
      filename: "packages/features/agent/server/src/projections/agent.projection.ts",
      code: "export class AgentProjection {}",
      errors: [{ messageId: "create" }],
    },
    {
      filename: "packages/features/agent/server/src/api/internal/agent.api.ts",
      code: "export function createAgentApi() { return {}; }",
      errors: [{ messageId: "concrete" }, { messageId: "standalone" }],
    },
    {
      filename: "packages/features/agent/server/src/api/internal/agent.api.ts",
      code: "class AgentApi { static create() { return new AgentApi(); } }",
      errors: [{ messageId: "concrete" }],
    },
    {
      filename: "packages/features/api-key/server/src/ports/credential.port.ts",
      code: "export type CredentialPort = { load(id: string): Promise<void>; };",
      errors: [{ messageId: "abstract" }],
    },
    {
      filename: "packages/features/api-key/server/src/ports/credential.port.ts",
      code: "export abstract class CredentialPort { abstract load(id: string): Promise<void>; } export type LegacyCredentialPort = { load(id: string): Promise<void>; };",
      errors: [{ messageId: "abstract" }],
    },
  ],
});

tester.run("service-classes", plugin.rules["service-classes"], {
  valid: [
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "function normalise() { return true; } export class AgentService { static create() { normalise(); return new AgentService(); } private constructor() {} }",
    },
  ],
  invalid: [
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "export function createAgentService() { return {}; }",
      errors: [{ messageId: "missing" }, { messageId: "standalone" }],
    },
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {}",
      errors: [{ messageId: "create" }],
    },
  ],
});

tester.run("service-quality", plugin.rules["service-quality"], {
  valid: [
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nstatic create() {\nreturn new AgentService();\n}\nprivate constructor() {}\nasync run() {\nconst value = await Promise.resolve(true);\nreturn value;\n}\n}",
    },
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: 'export class AgentService {\nstatic create() {\nreturn new AgentService();\n}\nprivate constructor() {}\n["literal"]() {\nreturn true;\n}\n}',
    },
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nstatic create() {\nreturn new AgentService();\n}\nprivate constructor() {}\noverload(input: string): string;\noverload(input: number): string;\noverload(input: string | number) {\nreturn String(input);\n}\n}",
    },
  ],
  invalid: [
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nstatic create() { return new AgentService(); }\nconstructor() {}\nrun() { return { repeated: 1, repeated: 2 }; }\n}",
      errors: [{ messageId: "publicConstructor" }, { messageId: "duplicateObjectKey" }],
    },
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: 'export class AgentService {\nstatic create() {\nreturn new AgentService();\n}\nprivate constructor() {}\nrun() {\nreturn { ["repeated"]: 1, ["repeated"]: 2 };\n}\n}',
      errors: [{ messageId: "duplicateObjectKey" }],
    },
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: 'export class AgentService {\nstatic create() { return new AgentService(); }\nprivate constructor() {}\noverload(input: string): string;\noverload(input: number): string;\noverload(input: string | number) { return String(input); }\noverload = () => "invalid second implementation";\n}',
      languageOptions: { parserOptions: { ignoreNonFatalErrors: true } },
      errors: [{ messageId: "duplicateMember" }],
    },
  ],
});

tester.run("max-statements-per-line", plugin.rules["max-statements-per-line"], {
  valid: [
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nstatic create() { return new AgentService(); }\nprivate constructor() {}\nrun() { return true; }\noverload(input: string): string;\noverload(input: number): string;\noverload(input: string | number) {\nreturn String(input);\n}\n}",
    },
  ],
  invalid: [
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nstatic create() { return new AgentService(); }\nprivate constructor() {}\nrun() {\nconst first = 1; const second = 2;\nreturn first + second;\n}\n}",
      errors: [{ messageId: "maxStatementsPerLine" }],
    },
  ],
});

tester.run("service-member-spacing", plugin.rules["service-member-spacing"], {
  valid: [
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nfirst() {}\n\n// This belongs to the following method.\nsecond() {}\n}",
    },
  ],
  invalid: [
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "export class AgentService {\nfirst() {}\nsecond() {}\n}",
      output: "export class AgentService {\nfirst() {}\n\nsecond() {}\n}",
      errors: [{ messageId: "memberSpacing" }],
    },
  ],
});

tester.run("api-context-services", plugin.rules["api-context-services"], {
  valid: [
    {
      filename: "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { async handle(context, input) { await context.authorize(input.permission); return context.app.agents.create({ ...input, actorId: context.actor().id }); } }",
    },
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "export class AgentService { constructor(repository) { this.repository = repository; } }",
    },
  ],
  invalid: [
    {
      filename: "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(context) { return this.options.service(context).list(); } }",
      errors: [{ messageId: "resolver" }],
    },
    {
      filename: "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(context) { return this.options.projectId(context); } }",
      errors: [{ messageId: "resolver" }],
    },
    {
      filename: "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(input) { return this.options.loadService(input.projectId).list(); } }",
      errors: [{ messageId: "resolver" }],
    },
    {
      filename: "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(context) { return (context as Context).app.agents.list(); } }",
      errors: [{ messageId: "contextCast" }],
    },
    {
      filename: "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle() { return new AgentService(); } }",
      errors: [{ messageId: "construction" }],
    },
    {
      filename: "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { async handle(context) { return await (await loadAgentService(context)).list(); } }",
      errors: [{ messageId: "doubleAwait" }],
    },
  ],
});

tester.run("service-dependencies", plugin.rules["service-dependencies"], {
  valid: [
    {
      filename: "platform/app/src/server/app-layer/organizations/organization.service.ts",
      code: 'import type { OrganizationRepository } from "./repositories/organization.repository"; import type { PromptTagService } from "../../prompt-config/prompt-tag.service"; export class OrganizationService {}',
    },
    {
      filename: "packages/features/organization/server/src/services/organization.service.ts",
      code: 'import type { OrganizationRepository } from "../repositories/organization.repository"; import type { ProjectService } from "@langwatch/project-contract"; export class OrganizationService {}',
    },
  ],
  invalid: [
    {
      filename: "platform/app/src/server/app-layer/organizations/organization.service.ts",
      code: 'import type { PromptTagRepository } from "../../prompt-config/repositories/prompt-tag.repository"; export class OrganizationService {}',
      errors: [{ messageId: "foreignRepository" }],
    },
    {
      filename: "platform/app/src/server/app-layer/organizations/organization.service.ts",
      code: 'import type { PromptTagRepository } from "../../prompt-config"; export class OrganizationService {}',
      errors: [{ messageId: "foreignRepository" }],
    },
    {
      filename: "packages/features/organization/server/src/services/organization.service.ts",
      code: 'import type { ProjectRepository } from "@langwatch/project-server"; export class OrganizationService {}',
      errors: [{ messageId: "foreignRepository" }],
    },
    {
      filename: "platform/app/src/server/app-layer/organizations/organization.service.ts",
      code: 'import { getApp } from "../app"; export class OrganizationService { run() { return getApp().projects; } }',
      errors: [{ messageId: "globalApplication" }],
    },
    {
      filename: "platform/app/src/server/app-layer/organizations/organization.service.ts",
      code: 'import type { PrismaClient } from "~/generated/prisma/client"; export class OrganizationService { constructor(readonly prisma: PrismaClient) {} }',
      errors: [{ messageId: "databaseClient" }],
    },
  ],
});

tester.run("runtime-undefined", plugin.rules["runtime-undefined"], {
  valid: [
    {
      filename: "packages/features/agent/contract/src/example.ts",
      code: `type Missing = undefined;
interface Result { value?: undefined }
const object = { undefined: 1 };
object.undefined;
export { value as undefined };`,
    },
    {
      filename: "packages/features/agent/contract/src/example.ts",
      code: `import { undefined as absent } from "fixture";
export { undefined } from "fixture";
const value = "undefined";`,
    },
    {
      filename: "packages/features/agent/contract/src/example.ts",
      code: `function read(undefined: unknown) { return undefined; }`,
    },
  ],
  invalid: [
    {
      filename: "packages/features/agent/contract/src/example.ts",
      code: `const a = undefined;
const b = obj[undefined];
const c = undefined as string;
const d = ({ undefined });`,
      output: `const a = void 0;
const b = obj[void 0];
const c = void 0 as string;
const d = ({ undefined: void 0 });`,
      errors: [
        { messageId: "runtimeUndefined" },
        { messageId: "runtimeUndefined" },
        { messageId: "runtimeUndefined" },
        { messageId: "runtimeUndefined" },
      ],
    },
    {
      filename: "packages/features/agent/contract/src/example.ts",
      code: `function read(value = undefined) { return value; }
if (value === undefined) throw undefined;`,
      output: `function read(value = void 0) { return value; }
if (value === void 0) throw void 0;`,
      errors: [
        { messageId: "runtimeUndefined" },
        { messageId: "runtimeUndefined" },
        { messageId: "runtimeUndefined" },
      ],
    },
  ],
});

tester.run("logical-statement-spacing", plugin.rules["logical-statement-spacing"], {
  valid: [
    {
      filename: "packages/features/agent/server/src/example.ts",
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
      filename: "packages/features/agent/server/src/example.ts",
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
      filename: "packages/features/agent/server/src/example.ts",
      code: `function run() {
  return true;
}`,
    },
  ],
  invalid: [
    {
      filename: "packages/features/agent/server/src/example.ts",
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
      filename: "packages/features/agent/server/src/example.ts",
      code: "function run() { if (ready) { start(); } finish(); }",
      output: "function run() { if (ready) { start(); }\n\n finish(); }",
      errors: [{ messageId: "statementSpacing" }],
    },
    {
      filename: "packages/features/agent/server/src/example.ts",
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
      filename: "packages/features/agent/server/src/example.ts",
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
      filename: "packages/features/api-key/server/src/services/api-key.service.ts",
      code: "export class ApiKeyService { async run() { return await this.repository.list(); } }",
    },
    {
      filename: "packages/features/api-key/server/src/services/api-key.service.ts",
      code: "export class ApiKeyService { async run() { return this.repository.list().map((item) => item.id); } }",
    },
  ],
  invalid: [
    {
      filename: "packages/features/api-key/server/src/services/api-key.service.ts",
      code: "export class ApiKeyService { async run() { return (await this.repository.list()).map((item) => item.id); } }",
      errors: [{ messageId: "awaitedReturnChain" }],
    },
    {
      filename: "packages/features/api-key/server/src/services/api-key.service.ts",
      code: "export class ApiKeyService { async run() { return (await this.repository.list()).data.items; } }",
      errors: [{ messageId: "awaitedReturnChain" }],
    },
  ],
});

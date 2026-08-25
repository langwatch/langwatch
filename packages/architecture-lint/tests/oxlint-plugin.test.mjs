import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";
import plugin from "../oxlint-plugin.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
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
      filename:
        "packages/features/agent/server/src/repositories/prisma/example.ts",
      code: 'import type { PrismaClient } from "@prisma/client"; export type Db = PrismaClient;',
    },
    {
      filename: "platform/app/src/runtime/app/example.ts",
      code: 'import { AgentService } from "@langwatch/agent-server"; export { AgentService };',
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
      filename: "packages/features/agent/contract/src/example.ts",
      code: 'import { z } from "zod/v4"; export const value = z.string();',
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

tester.run(
  "environment-boundaries",
  plugin.rules["environment-boundaries"],
  {
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
  },
);

tester.run("feature-module-classes", plugin.rules["feature-module-classes"], {
  valid: [
    {
      filename: "packages/features/agent/contract/src/agent.service.ts",
      code: "export abstract class AgentService {}",
    },
    {
      filename:
        "packages/features/agent/server/src/repositories/agent.repository.ts",
      code: "export abstract class AgentRepository {}",
    },
    {
      filename:
        "packages/features/agent/server/src/repositories/prisma/prisma.agent.repository.ts",
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
      filename:
        "packages/features/agent/server/src/projections/agent.projection.ts",
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

tester.run("api-context-services", plugin.rules["api-context-services"], {
  valid: [
    {
      filename:
        "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { async handle(context, input) { await context.authorize(input.permission); return context.app.agents.create({ ...input, actorId: context.actor().id }); } }",
    },
    {
      filename: "packages/features/agent/server/src/services/agent.service.ts",
      code: "export class AgentService { constructor(repository) { this.repository = repository; } }",
    },
  ],
  invalid: [
    {
      filename:
        "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(context) { return this.options.service(context).list(); } }",
      errors: [{ messageId: "resolver" }],
    },
    {
      filename:
        "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(context) { return this.options.projectId(context); } }",
      errors: [{ messageId: "resolver" }],
    },
    {
      filename:
        "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(input) { return this.options.loadService(input.projectId).list(); } }",
      errors: [{ messageId: "resolver" }],
    },
    {
      filename:
        "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle(context) { return (context as Context).app.agents.list(); } }",
      errors: [{ messageId: "contextCast" }],
    },
    {
      filename:
        "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { handle() { return new AgentService(); } }",
      errors: [{ messageId: "construction" }],
    },
    {
      filename:
        "packages/features/agent/server/src/api/public/agent.api.ts",
      code: "export class AgentApi { async handle(context) { return await (await loadAgentService(context)).list(); } }",
      errors: [{ messageId: "doubleAwait" }],
    },
  ],
});

tester.run("service-dependencies", plugin.rules["service-dependencies"], {
  valid: [
    {
      filename:
        "platform/app/src/server/app-layer/organizations/organization.service.ts",
      code: 'import type { OrganizationRepository } from "./repositories/organization.repository"; import type { PromptTagService } from "../../prompt-config/prompt-tag.service"; export class OrganizationService {}',
    },
    {
      filename:
        "packages/features/organization/server/src/services/organization.service.ts",
      code: 'import type { OrganizationRepository } from "../repositories/organization.repository"; import type { ProjectService } from "@langwatch/project-contract"; export class OrganizationService {}',
    },
  ],
  invalid: [
    {
      filename:
        "platform/app/src/server/app-layer/organizations/organization.service.ts",
      code: 'import type { PromptTagRepository } from "../../prompt-config/repositories/prompt-tag.repository"; export class OrganizationService {}',
      errors: [{ messageId: "foreignRepository" }],
    },
    {
      filename:
        "platform/app/src/server/app-layer/organizations/organization.service.ts",
      code: 'import type { PromptTagRepository } from "../../prompt-config"; export class OrganizationService {}',
      errors: [{ messageId: "foreignRepository" }],
    },
    {
      filename:
        "packages/features/organization/server/src/services/organization.service.ts",
      code: 'import type { ProjectRepository } from "@langwatch/project-server"; export class OrganizationService {}',
      errors: [{ messageId: "foreignRepository" }],
    },
    {
      filename:
        "platform/app/src/server/app-layer/organizations/organization.service.ts",
      code: 'import { getApp } from "../app"; export class OrganizationService { run() { return getApp().projects; } }',
      errors: [{ messageId: "globalApplication" }],
    },
    {
      filename:
        "platform/app/src/server/app-layer/organizations/organization.service.ts",
      code: 'import type { PrismaClient } from "~/generated/prisma/client"; export class OrganizationService { constructor(readonly prisma: PrismaClient) {} }',
      errors: [{ messageId: "databaseClient" }],
    },
  ],
});

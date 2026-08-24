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
      filename: "packages/features/agents/contract/src/example.ts",
      code: 'import { z } from "zod"; export const value = z.string();',
    },
    {
      filename:
        "packages/features/agents/server/src/repositories/prisma/example.ts",
      code: 'import type { PrismaClient } from "@prisma/client"; export type Db = PrismaClient;',
    },
    {
      filename: "platform/app/src/runtime/app/example.ts",
      code: 'import { AgentService } from "@langwatch/agents-server"; export { AgentService };',
    },
  ],
  invalid: [
    {
      filename: "packages/features/agents/contract/src/example.ts",
      code: 'import React from "react"; export { React };',
      errors: [{ messageId: "packageRole" }],
    },
    {
      filename: "packages/features/agents/server/src/example.ts",
      code: 'import type { ReactNode } from "react"; export type Value = ReactNode;',
      errors: [{ messageId: "packageRole" }],
    },
    {
      filename: "platform/app/src/server/example.ts",
      code: 'import { AgentService } from "@langwatch/agents-server"; export { AgentService };',
      errors: [{ messageId: "compositionRoot" }],
    },
    {
      filename: "packages/features/agents/contract/src/example.ts",
      code: 'export { AgentService } from "../../server/src";',
      errors: [{ messageId: "packageEscape" }],
    },
    {
      filename: "packages/features/entitlements/contract/src/example.ts",
      code: 'export { Agent } from "@langwatch/agents-contract/private";',
      errors: [{ messageId: "sealedExports" }],
    },
    {
      filename: "packages/features/agents/server/src/services/example.ts",
      code: 'import type { PrismaClient } from "@prisma/client"; export type Db = PrismaClient;',
      errors: [{ messageId: "prismaContainment" }],
    },
    {
      filename: "packages/features/agents/contract/src/example.ts",
      code: "export const value = process.env.AGENTS_VALUE;",
      errors: [{ messageId: "environment" }],
    },
    {
      filename: "packages/features/agents/contract/src/example.ts",
      code: 'import { z } from "zod/v3"; export const value = z.string();',
      errors: [{ messageId: "schemaBoundary" }],
    },
    {
      filename: "packages/features/agents/server/src/example.ts",
      code: 'import { zValidator } from "@hono/zod-validator"; export { zValidator };',
      errors: [{ messageId: "schemaBoundary" }],
    },
    {
      filename: "packages/features/agents/server/src/example.ts",
      code: 'import { resolver } from "hono-openapi/zod"; export { resolver };',
      errors: [{ messageId: "schemaBoundary" }],
    },
    {
      filename: "packages/features/agents/server/src/api/internal/agent.api.ts",
      code: 'import type { AgentRepository } from "../../repositories/agent.repository"; export type Value = AgentRepository;',
      errors: [{ messageId: "featureLayer" }],
    },
    {
      filename: "packages/features/agents/server/src/services/agent.service.ts",
      code: 'import type { AgentApi } from "../api/internal/agent.api"; export type Value = AgentApi;',
      errors: [{ messageId: "featureLayer" }],
    },
    {
      filename: "packages/features/agents/server/src/services/agent.service.ts",
      code: 'import { PrismaAgentRepository } from "../repositories/prisma/prisma.agent.repository"; export { PrismaAgentRepository };',
      errors: [{ messageId: "featureLayer" }],
    },
  ],
});

tester.run("feature-module-classes", plugin.rules["feature-module-classes"], {
  valid: [
    {
      filename: "packages/features/agents/contract/src/agent.service.ts",
      code: "export abstract class AgentService {}",
    },
    {
      filename:
        "packages/features/agents/server/src/repositories/agent.repository.ts",
      code: "export abstract class AgentRepository {}",
    },
    {
      filename:
        "packages/features/agents/server/src/repositories/prisma/prisma.agent.repository.ts",
      code: "export class PrismaAgentRepository { static create() { return new PrismaAgentRepository(); } }",
    },
    {
      filename: "packages/features/agents/server/src/api/internal/agent.api.ts",
      code: "export class AgentApi { static create() { return new AgentApi(); } }",
    },
  ],
  invalid: [
    {
      filename: "packages/features/agents/contract/src/agent.service.ts",
      code: "export interface AgentService {}",
      errors: [{ messageId: "abstract" }],
    },
    {
      filename:
        "packages/features/agents/server/src/projections/agent.projection.ts",
      code: "export class AgentProjection {}",
      errors: [{ messageId: "create" }],
    },
    {
      filename: "packages/features/agents/server/src/api/internal/agent.api.ts",
      code: "export function createAgentApi() { return {}; }",
      errors: [{ messageId: "concrete" }, { messageId: "standalone" }],
    },
    {
      filename: "packages/features/agents/server/src/api/internal/agent.api.ts",
      code: "class AgentApi { static create() { return new AgentApi(); } }",
      errors: [{ messageId: "concrete" }],
    },
  ],
});

tester.run("service-classes", plugin.rules["service-classes"], {
  valid: [
    {
      filename: "packages/features/agents/server/src/services/agent.service.ts",
      code: "function normalise() { return true; } export class AgentService { static create() { normalise(); return new AgentService(); } private constructor() {} }",
    },
  ],
  invalid: [
    {
      filename: "packages/features/agents/server/src/services/agent.service.ts",
      code: "export function createAgentService() { return {}; }",
      errors: [{ messageId: "missing" }, { messageId: "standalone" }],
    },
    {
      filename: "packages/features/agents/server/src/services/agent.service.ts",
      code: "export class AgentService {}",
      errors: [{ messageId: "create" }],
    },
  ],
});

tester.run("no-conditional-spread", plugin.rules["no-conditional-spread"], {
  valid: [
    {
      filename: "packages/features/agents/server/src/example.ts",
      code: "const value = {}; if (enabled) value.name = name;",
    },
  ],
  invalid: [
    {
      filename: "packages/features/agents/server/src/example.ts",
      code: "const value = { ...(enabled ? { name } : {}) };",
      errors: [{ messageId: "conditional" }],
    },
  ],
});

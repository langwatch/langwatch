import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintWorkspace } from "../src";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-architecture-lint-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function className(value: string): string {
  return value
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function featurePackage({
  feature,
  role,
  name = `@langwatch/${feature}-${role}`,
  dependencies = {},
  exports = { ".": "./src/index.ts" },
  source = "export const value = true;",
  enterprise = false,
  layoutVersion = 0,
  subjects,
}: {
  feature: string;
  role: "contract" | "server" | "web";
  name?: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
  source?: string;
  enterprise?: boolean;
  layoutVersion?: 0;
  subjects?: string[];
}): void {
  const prefix = enterprise
    ? `packages/enterprise/features/${feature}/${role}`
    : `packages/features/${feature}/${role}`;
  const featureRoot = enterprise
    ? `packages/enterprise/features/${feature}`
    : `packages/features/${feature}`;
  const decisionMarker = feature.split("").reverse().join("");
  const adrName = "001-package-boundary.md";
  const cataloguePath = join(root, "packages/features/catalogue.json");
  const catalogue = existsSync(cataloguePath)
    ? (JSON.parse(readFileSync(cataloguePath, "utf8")) as {
        version: 0;
        features: Array<{
          id: string;
          root: string;
          classification: "core" | "enterprise";
          subjects: string[];
        }>;
      })
    : { version: 0 as const, features: [] };
  const entry = {
    id: feature,
    root: featureRoot,
    classification: enterprise ? ("enterprise" as const) : ("core" as const),
    subjects: subjects ?? [feature],
  };
  catalogue.features = catalogue.features
    .filter(({ id }) => id !== feature)
    .concat(entry)
    .sort((left, right) => {
      const classificationOrder =
        Number(left.classification === "enterprise") -
        Number(right.classification === "enterprise");
      return classificationOrder || left.id.localeCompare(right.id);
    });
  write("packages/features/catalogue.json", JSON.stringify(catalogue));
  write(`${featureRoot}/feature.json`, JSON.stringify({ layoutVersion }));
  write(
    `${featureRoot}/adrs/${adrName}`,
    `# ADR-001: ${feature} package boundary

**Status:** Proposed

**Behavioural contract:** [Package boundary](../specs/package-boundary.feature)

## Context

The ${feature} feature currently has caller-owned behaviour that can diverge. Its test decision marker is ${decisionMarker}.

## Decision

The ${feature} contract owns its portable vocabulary and service capability. Its test decision marker is ${decisionMarker}.

### Public surfaces and transports

The ${feature} transport delegates to its process-owned contract service. Its test decision marker is ${decisionMarker}.

### Dependencies

The ${feature} server depends on portable contracts and injected host ports. Its test decision marker is ${decisionMarker}.

### Persistence

The ${feature} repository maps private records into its portable contract values. Its test decision marker is ${decisionMarker}.

### Runtime and registration

Runtime composition constructs one ${feature} service without import-time registration. Its test decision marker is ${decisionMarker}.

### Environment and configuration

The boot root validates ${feature} configuration before constructing its service. Its test decision marker is ${decisionMarker}.

### Errors

The ${feature} contract names its domain errors and transports map them once. Its test decision marker is ${decisionMarker}.

### Contracts and validation

Zod 4 schemas validate ${feature} inputs without importing server implementation code. Its test decision marker is ${decisionMarker}.

## Consequences

The ${feature} implementation becomes singular at the cost of explicit composition. Its test decision marker is ${decisionMarker}.
`,
  );
  write(`${featureRoot}/adrs/README.md`, `- [Boundary](./${adrName})\n`);
  write(`${featureRoot}/specs/package-boundary.feature`, `Feature: ${feature}\n`);
  write(
    `${prefix}/package.json`,
    JSON.stringify({
      name,
      type: "module",
      exports,
      dependencies:
        role === "contract" ? { zod: "^4.4.3", ...dependencies } : dependencies,
    }),
  );
  write(
    `${prefix}/tsconfig.json`,
    JSON.stringify({
      compilerOptions: {
        target: "es2022",
        module: "preserve",
        moduleResolution: "bundler",
        strict: true,
      },
      include: ["src/**/*.ts"],
    }),
  );
  write(`${prefix}/src/index.ts`, source);
  const serviceName = `${className(feature)}Service`;
  if (layoutVersion === 0 && role === "contract") {
    write(
      `${prefix}/src/${feature}.service.ts`,
      `export abstract class ${serviceName} {}`,
    );
  }
  if (layoutVersion === 0 && role === "server") {
    write(
      `${prefix}/src/services/${feature}.service.ts`,
      `export class ${serviceName} { static create(): ${serviceName} { return new ${serviceName}(); } }`,
    );
  }
}

function policies(options?: { declarations?: boolean }): string[] {
  return lintWorkspace({
    root,
    declarations: options?.declarations ?? false,
  }).map((violation) => violation.policy);
}

describe("feature package boundary lint", () => {
  /** @scenario A valid feature graph passes */
  it("accepts portable contracts and role-correct dependencies", () => {
    featurePackage({ feature: "workflow", role: "contract" });
    featurePackage({
      feature: "agent",
      role: "contract",
      dependencies: { "@langwatch/workflow-contract": "workspace:*" },
      source:
        'import type { value } from "@langwatch/workflow-contract"; export type Agent = typeof value;',
    });
    featurePackage({
      feature: "agent",
      role: "server",
      dependencies: { "@langwatch/agent-contract": "workspace:*" },
      source:
        'import type { Agent } from "@langwatch/agent-contract"; export const create = (agent: Agent) => agent;',
    });
    featurePackage({
      feature: "agent",
      role: "web",
      dependencies: { "@langwatch/agent-contract": "workspace:*" },
      source:
        'import type { Agent } from "@langwatch/agent-contract"; export type AgentView = Agent;',
    });

    expect(lintWorkspace({ root, declarations: false })).toEqual([]);
  });

  /** @scenario Physical package names match their feature roles */
  it("rejects a name that does not match its physical role", () => {
    featurePackage({
      feature: "agent",
      role: "contract",
      name: "@langwatch/agents",
    });
    expect(policies()).toContain("feature-layout");
  });

  it("rejects the retired Zod runtime in a feature contract", () => {
    featurePackage({
      feature: "agent",
      role: "contract",
      dependencies: { zod: "^3.25.76" },
    });

    expect(policies()).toContain("retired-package-runtime");
  });

  it("rejects the retired Zod runtime in any governed feature surface", () => {
    featurePackage({
      feature: "agent",
      role: "server",
      dependencies: { zod: "^3.25.76" },
    });

    expect(policies()).toContain("retired-package-runtime");
  });

  /** @scenario Every feature package owns a complete architecture record */
  it("rejects an incomplete feature boundary ADR", () => {
    featurePackage({ feature: "agent", role: "contract" });
    write(
      "packages/features/agent/adrs/001-package-boundary.md",
      "# ADR-001: Agents\n\n**Status:** Proposed\n\n## Context\n\nToo little.\n",
    );

    expect(policies()).toContain("architecture-record");
  });

  /** @scenario Web production code cannot acquire backend dependencies */
  it("rejects backend dependencies from web source", () => {
    featurePackage({ feature: "agent", role: "server" });
    featurePackage({
      feature: "agent",
      role: "web",
      dependencies: { "@langwatch/agent-server": "workspace:*" },
      source:
        'import type { value } from "@langwatch/agent-server"; export type View = typeof value;',
    });
    expect(policies()).toContain("package-role");
  });

  it("rejects camelCase filenames across strict contract, server, and web sources", () => {
    featurePackage({ feature: "agent", role: "contract" });
    featurePackage({ feature: "agent", role: "server" });
    featurePackage({ feature: "agent", role: "web" });
    write(
      "packages/features/agent/contract/src/agentCommands.ts",
      "export const value = true;",
    );
    write(
      "packages/features/agent/server/src/services/agentService.service.ts",
      "export const value = true;",
    );
    write(
      "packages/features/agent/server/src/repositories/prisma.agent.repository.ts",
      "export const value = true;",
    );
    write("packages/features/agent/web/src/agentCard.tsx", "export const value = true;");

    const violations = lintWorkspace({ root, declarations: false }).filter(
      ({ policy }) => policy === "feature-source-filename",
    );
    expect(violations).toHaveLength(3);
    expect(violations.map(({ file }) => file)).toEqual([
      "packages/features/agent/contract/src/agentCommands.ts",
      "packages/features/agent/server/src/services/agentService.service.ts",
      "packages/features/agent/web/src/agentCard.tsx",
    ]);
  });

  it("accepts canonical dotted artifact roles with kebab-case subjects", () => {
    featurePackage({ feature: "agent", role: "contract" });
    featurePackage({ feature: "agent", role: "server" });
    write(
      "packages/features/agent/contract/src/this-this.service.ts",
      "export abstract class ThisThisService {}",
    );
    write(
      "packages/features/agent/server/src/repositories/prisma/prisma.ingestion-source.repository.ts",
      "export abstract class PrismaIngestionSourceRepository {}",
    );
    write(
      "packages/features/agent/server/src/adapters/clickhouse.trace.adapter.ts",
      "export class ClickhouseTraceAdapter { static create() { return new ClickhouseTraceAdapter(); } }",
    );
    write(
      "packages/features/agent/server/src/ports/simulation-execution.port.ts",
      "export abstract class SimulationExecutionPort {}",
    );

    expect(
      lintWorkspace({ root, declarations: false }).filter(
        ({ policy }) => policy === "feature-source-filename",
      ),
    ).toEqual([]);
  });

  it("rejects merged known server qualifiers but accepts kebab-case subjects", () => {
    featurePackage({ feature: "data-retention", role: "server" });
    write(
      "packages/features/data-retention/server/src/repositories/prisma-data-retention.repository.ts",
      "export class PrismaDataRetentionRepository {}",
    );
    write(
      "packages/features/data-retention/server/src/repositories/prisma-pinned-trace.repository.ts",
      "export class PrismaPinnedTraceRepository {}",
    );
    write(
      "packages/features/data-retention/server/src/repositories/prisma/prisma.data-retention.repository.ts",
      "export class PrismaDataRetentionRepository {}",
    );
    write(
      "packages/features/data-retention/server/src/stores/data-retention-cache.store.ts",
      "export class DataRetentionCacheStore {}",
    );

    const violations = lintWorkspace({ root, declarations: false }).filter(
      ({ policy }) => policy === "feature-source-filename",
    );
    expect(violations.map(({ file }) => file)).toEqual([
      "packages/features/data-retention/server/src/repositories/prisma-data-retention.repository.ts",
      "packages/features/data-retention/server/src/repositories/prisma-pinned-trace.repository.ts",
    ]);
  });

  /** @scenario Cross-feature collaboration uses only contracts */
  it("rejects another feature server even through a type-only import", () => {
    featurePackage({ feature: "workflow", role: "server" });
    featurePackage({
      feature: "agent",
      role: "server",
      dependencies: { "@langwatch/workflow-server": "workspace:*" },
      source:
        'import type { value } from "@langwatch/workflow-server"; export type Value = typeof value;',
    });
    expect(policies()).toContain("cross-feature");
  });

  /** @scenario Core packages cannot import enterprise implementations */
  it("rejects enterprise dependencies from core", () => {
    featurePackage({
      feature: "billing",
      role: "contract",
      name: "@langwatch/enterprise-billing-contract",
      enterprise: true,
    });
    featurePackage({
      feature: "entitlement",
      role: "server",
      dependencies: { "@langwatch/enterprise-billing-contract": "workspace:*" },
      source:
        'import type { value } from "@langwatch/enterprise-billing-contract"; export type Value = typeof value;',
    });
    expect(policies()).toContain("enterprise-direction");
  });

  /** @scenario Wildcard exports are forbidden for feature packages */
  it("rejects wildcard exports", () => {
    featurePackage({
      feature: "agent",
      role: "server",
      exports: { ".": "./src/index.ts", "./*": "./src/*.ts" },
    });
    expect(policies()).toContain("public-exports");
  });

  it("rejects private persistence exported through a server root barrel", () => {
    featurePackage({
      feature: "agent",
      role: "server",
      source: 'export { AgentRepository } from "./repositories/agent.repository";',
    });

    expect(policies()).toContain("private-runtime-export");
  });

  /** @scenario Prisma cannot leak through public declarations */
  it("rejects Prisma in emitted declarations", () => {
    featurePackage({
      feature: "agent",
      role: "server",
      source: 'export type Leaked = import("@prisma/client").PrismaClient;',
    });
    expect(policies({ declarations: true })).toContain("public-declarations");
  });

  /** @scenario Repository lint includes package architecture */
  it("returns violations for the CLI to turn into a non-zero exit", () => {
    featurePackage({
      feature: "agent",
      role: "contract",
      name: "@langwatch/not-agents-contract",
    });
    expect(lintWorkspace({ root, declarations: false }).length).toBeGreaterThan(0);
  });
});

describe("strict feature source layout", () => {
  /** @scenario A strict feature declares its layout version */
  it("accepts canonical version-0 contract and server source", () => {
    featurePackage({ feature: "agent", role: "contract", layoutVersion: 0 });
    write(
      "packages/features/agent/contract/src/agent.service.ts",
      "export abstract class AgentService {}",
    );
    featurePackage({ feature: "agent", role: "server", layoutVersion: 0 });
    write(
      "packages/features/agent/server/src/services/agent.service.ts",
      "export class AgentService { static create() { return new AgentService(); } }",
    );
    write(
      "packages/features/agent/server/src/repositories/agent.repository.ts",
      "export abstract class AgentRepository {}",
    );
    write(
      "packages/features/agent/server/src/repositories/prisma/prisma.agent.repository.ts",
      "export class PrismaAgentRepository { static create() { return new PrismaAgentRepository(); } }",
    );
    write(
      "packages/features/agent/server/src/transport/api-rest/agent.api.ts",
      "export class AgentApi { static create() { return new AgentApi(); } }",
    );
    write(
      "packages/features/agent/server/src/fixtures/agent.fixture.ts",
      "export const agentFixture = { id: 'agent_1' };",
    );
    write(
      "packages/features/agent/server/src/subscribers/agent.subscriber.ts",
      "export class AgentSubscriber { static create() { return new AgentSubscriber(); } }",
    );

    expect(policies()).not.toContain("feature-source-layout");
  });

  /** @scenario Unknown or missing layout versions fail */
  it("rejects a missing or unknown layout version", () => {
    featurePackage({ feature: "agent", role: "contract" });
    rmSync(join(root, "packages/features/agent/feature.json"));
    expect(policies()).toContain("feature-source-layout");

    write("packages/features/agent/feature.json", JSON.stringify({ layoutVersion: 99 }));
    expect(policies()).toContain("feature-source-layout");
  });

  /** @scenario Server artifacts have canonical homes and names */
  it("rejects unknown server layers and non-canonical adapter names", () => {
    featurePackage({ feature: "agent", role: "server", layoutVersion: 0 });
    write(
      "packages/features/agent/server/src/services/agent.service.ts",
      "export class AgentService {}",
    );
    write(
      "packages/features/agent/server/src/composition/agent.runtime.ts",
      "export const runtime = true;",
    );
    write(
      "packages/features/agent/server/src/repositories/prisma/prisma.agent.extra.repository.ts",
      "export class PrismaAgentRepository {}",
    );

    const layoutPolicies = policies().filter(
      (policy) => policy === "feature-source-layout",
    );
    expect(layoutPolicies).toHaveLength(2);
  });

  it("rejects a process manager disguised as a service", () => {
    featurePackage({ feature: "agent", role: "server", layoutVersion: 0 });
    write(
      "packages/features/agent/server/src/services/agent-process.service.ts",
      "export class AgentProcessService {}",
    );

    expect(policies()).toContain("feature-source-layout");
  });

  /** @scenario Contract artifacts remain portable and named */
  it("rejects bare contract artifact names and server artifacts", () => {
    featurePackage({ feature: "agent", role: "contract", layoutVersion: 0 });
    write(
      "packages/features/agent/contract/src/service.ts",
      "export abstract class AgentService {}",
    );
    write(
      "packages/features/agent/contract/src/agent.repository.ts",
      "export abstract class AgentRepository {}",
    );

    const layoutPolicies = policies().filter(
      (policy) => policy === "feature-source-layout",
    );
    expect(layoutPolicies.length).toBeGreaterThanOrEqual(2);
  });

  /** @scenario Central subjects make broad feature ownership explicit */
  it("rejects contract and server modules that claim another feature subject", () => {
    featurePackage({ feature: "anomaly-rule", role: "contract" });
    featurePackage({
      feature: "governance",
      role: "contract",
      subjects: ["governance", "ingestion-pull", "pulled-usage"],
    });
    write(
      "packages/features/governance/contract/src/anomaly-rule.service.ts",
      "export abstract class AnomalyRuleService {}",
    );
    featurePackage({
      feature: "governance",
      role: "server",
      subjects: ["governance", "ingestion-pull", "pulled-usage"],
    });
    write(
      "packages/features/governance/server/src/services/ingestion-pull-process.service.ts",
      "export class IngestionPullProcessService { static create() { return new IngestionPullProcessService(); } }",
    );

    const subjectViolations = lintWorkspace({
      root,
      declarations: false,
    }).filter((violation) => violation.policy === "feature-source-subject");
    expect(subjectViolations).toHaveLength(1);
    expect(subjectViolations[0]?.file).toContain("anomaly-rule.service.ts");
  });

  it("treats the last qualifier as the subject of a technology adapter", () => {
    featurePackage({ feature: "licensing", role: "contract" });
    featurePackage({ feature: "sso", role: "server" });
    write(
      "packages/features/sso/server/src/adapters/licensing.sso.adapter.ts",
      "export class LicensingSsoAdapter {}",
    );

    const subjectViolations = lintWorkspace({
      root,
      declarations: false,
    }).filter((violation) => violation.policy === "feature-source-subject");
    expect(subjectViolations).toEqual([]);
  });

  it("rejects malformed central subject declarations", () => {
    featurePackage({
      feature: "governance",
      role: "contract",
      subjects: ["pulled-usage", "ingestion-pull", "ingestion-pull"],
    });

    expect(policies()).toContain("feature-catalogue");
  });

  it("rejects local subject ownership expansion", () => {
    featurePackage({ feature: "governance", role: "contract" });
    write(
      "packages/features/governance/feature.json",
      JSON.stringify({ layoutVersion: 0, subjects: ["project"] }),
    );

    expect(policies()).toContain("feature-source-subject");
  });
});

describe("Prisma client containment", () => {
  /** @scenario Prisma imports stay in concrete adapters */
  it("allows generated Prisma only in strict feature Prisma adapters", () => {
    featurePackage({ feature: "agent", role: "server" });
    write(
      "packages/features/agent/server/src/repositories/prisma/prisma.agents.repository.ts",
      'import type { Prisma } from "@langwatch/prisma-client/generated"; export class PrismaAgentsRepository { static create(_query: Prisma.AgentWhereInput) { return new PrismaAgentsRepository(); } }',
    );

    expect(policies()).not.toContain("prisma-containment");
  });

  it("rejects generated Prisma from contract, web, and feature service source", () => {
    featurePackage({
      feature: "agent",
      role: "contract",
      source: 'export type { PrismaClient } from "@langwatch/prisma-client/generated";',
    });
    featurePackage({
      feature: "agent",
      role: "web",
      source: 'export type { PrismaClient } from "@langwatch/prisma-client/generated";',
    });
    featurePackage({ feature: "agent", role: "server" });
    write(
      "packages/features/agent/server/src/services/agents.service.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated"; export class AgentsService { static create(_client: PrismaClient) { return new AgentsService(); } }',
    );

    expect(policies().filter((policy) => policy === "prisma-containment")).toHaveLength(
      3,
    );
  });

  it("allows lifecycle construction in an app but rejects it from feature services", () => {
    featurePackage({ feature: "agent", role: "server" });
    write(
      "packages/features/agent/server/src/services/agents.service.ts",
      'import type { PrismaConnectionService } from "@langwatch/prisma-client"; export class AgentsService { static create(_connection: PrismaConnectionService) { return new AgentsService(); } }',
    );
    write(
      "apps/api/package.json",
      JSON.stringify({
        name: "@langwatch/platform-api",
        type: "module",
        exports: { ".": "./src/index.ts" },
      }),
    );
    write(
      "apps/api/src/index.ts",
      'import { PrismaConnectionService } from "@langwatch/prisma-client"; export { PrismaConnectionService };',
    );

    expect(policies().filter((policy) => policy === "prisma-containment")).toHaveLength(
      1,
    );
  });

  /** @scenario Prisma cannot leak through public declarations */
  it("rejects generated Prisma reached through a public server re-export", () => {
    featurePackage({
      feature: "agent",
      role: "server",
      source:
        'export type { PrismaBacked } from "./repositories/prisma/prisma.agents.repository";',
    });
    write(
      "packages/features/agent/server/src/repositories/prisma/prisma.agents.repository.ts",
      'export type { Prisma as PrismaBacked } from "@langwatch/prisma-client/generated";',
    );

    expect(policies({ declarations: true })).toContain("public-declarations");
  });
});

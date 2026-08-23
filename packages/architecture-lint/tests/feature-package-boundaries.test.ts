import {
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
}: {
  feature: string;
  role: "contract" | "server" | "web";
  name?: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
  source?: string;
  enterprise?: boolean;
  layoutVersion?: 0;
}): void {
  const prefix = enterprise
    ? `packages/enterprise/features/${feature}/${role}`
    : `packages/features/${feature}/${role}`;
  const featureRoot = enterprise
    ? `packages/enterprise/features/${feature}`
    : `packages/features/${feature}`;
  const adrName = "001-package-boundary.md";
  write(`${featureRoot}/feature.json`, JSON.stringify({ layoutVersion }));
  write(
    `${featureRoot}/adrs/${adrName}`,
    `# ADR-001: ${feature} package boundary

**Status:** Proposed

**Behavioural contract:** [Package boundary](../specs/package-boundary.feature)

## Context

This package context explains the existing pressure and ownership problem.

## Decision

This decision defines the package shape and its supported responsibilities.

### Public surfaces and transports

The package exposes only the deliberate surfaces described by this boundary.

### Dependencies

Dependencies follow the declared package roles and point toward portable contracts.

### Persistence

Persistence remains private and maps records into portable values at boundaries.

### Runtime and registration

Runtime registration is explicit, side-effect free, and owned by composition roots.

### Environment and configuration

Environment values are validated by runtimes and injected as narrow configuration.

### Errors

Errors are concrete, identifier rich, and mapped once by each transport.

### Contracts and validation

Zod schemas define portable contracts and compile independently from runtime code.

## Consequences

The package gains enforceable boundaries at the cost of explicit composition.
`,
  );
  write(`${featureRoot}/adrs/README.md`, `- [Boundary](./${adrName})\n`);
  write(
    `${featureRoot}/specs/package-boundary.feature`,
    `Feature: ${feature}\n`,
  );
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
      `export class ${serviceName} { static create() { return new ${serviceName}(); } }`,
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
    featurePackage({ feature: "workflows", role: "contract" });
    featurePackage({
      feature: "agents",
      role: "contract",
      dependencies: { "@langwatch/workflows-contract": "workspace:*" },
      source:
        'import type { value } from "@langwatch/workflows-contract"; export type Agent = typeof value;',
    });
    featurePackage({
      feature: "agents",
      role: "server",
      dependencies: { "@langwatch/agents-contract": "workspace:*" },
      source:
        'import type { Agent } from "@langwatch/agents-contract"; export const create = (agent: Agent) => agent;',
    });
    featurePackage({
      feature: "agents",
      role: "web",
      dependencies: { "@langwatch/agents-contract": "workspace:*" },
      source:
        'import type { Agent } from "@langwatch/agents-contract"; export type AgentView = Agent;',
    });

    expect(lintWorkspace({ root, declarations: false })).toEqual([]);
  });

  /** @scenario Physical package names match their feature roles */
  it("rejects a name that does not match its physical role", () => {
    featurePackage({
      feature: "agents",
      role: "contract",
      name: "@langwatch/agents",
    });
    expect(policies()).toContain("feature-layout");
  });

  /** @scenario Governed packages use one schema runtime */
  it("rejects Zod 3 in a feature contract manifest", () => {
    featurePackage({
      feature: "agents",
      role: "contract",
      dependencies: { zod: "^3.25.76" },
    });

    expect(policies()).toContain("schema-runtime");
  });

  /** @scenario Every feature package owns a complete architecture record */
  it("rejects an incomplete feature boundary ADR", () => {
    featurePackage({ feature: "agents", role: "contract" });
    write(
      "packages/features/agents/adrs/001-package-boundary.md",
      "# ADR-001: Agents\n\n**Status:** Proposed\n\n## Context\n\nToo little.\n",
    );

    expect(policies()).toContain("architecture-record");
  });

  it("rejects required sections that contain only placeholder prose", () => {
    featurePackage({ feature: "agents", role: "contract" });
    const path = "packages/features/agents/adrs/001-package-boundary.md";
    const content = readFileSync(join(root, path), "utf8").replace(
      "This package context explains the existing pressure and ownership problem.",
      "TODO",
    );
    write(path, content);

    expect(policies()).toContain("architecture-record");
  });

  /** @scenario Web production code cannot acquire backend dependencies */
  it("rejects backend dependencies from web source", () => {
    featurePackage({ feature: "agents", role: "server" });
    featurePackage({
      feature: "agents",
      role: "web",
      dependencies: { "@langwatch/agents-server": "workspace:*" },
      source:
        'import type { value } from "@langwatch/agents-server"; export type View = typeof value;',
    });
    expect(policies()).toContain("package-role");
  });

  /** @scenario Cross-feature collaboration uses only contracts */
  it("rejects another feature server even through a type-only import", () => {
    featurePackage({ feature: "workflows", role: "server" });
    featurePackage({
      feature: "agents",
      role: "server",
      dependencies: { "@langwatch/workflows-server": "workspace:*" },
      source:
        'import type { value } from "@langwatch/workflows-server"; export type Value = typeof value;',
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
      feature: "entitlements",
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
      feature: "agents",
      role: "server",
      exports: { ".": "./src/index.ts", "./*": "./src/*.ts" },
    });
    expect(policies()).toContain("public-exports");
  });

  /** @scenario Prisma cannot leak through public declarations */
  it("rejects Prisma in emitted declarations", () => {
    featurePackage({
      feature: "agents",
      role: "server",
      source: 'export type Leaked = import("@prisma/client").PrismaClient;',
    });
    expect(policies({ declarations: true })).toContain("public-declarations");
  });

  /** @scenario Repository lint includes package architecture */
  it("returns violations for the CLI to turn into a non-zero exit", () => {
    featurePackage({
      feature: "agents",
      role: "contract",
      name: "@langwatch/not-agents-contract",
    });
    expect(lintWorkspace({ root, declarations: false }).length).toBeGreaterThan(
      0,
    );
  });
});

describe("strict feature source layout", () => {
  /** @scenario A strict feature declares its layout version */
  it("accepts canonical version-0 contract and server source", () => {
    featurePackage({ feature: "agents", role: "contract", layoutVersion: 0 });
    write(
      "packages/features/agents/contract/src/agent.service.ts",
      "export abstract class AgentService {}",
    );
    featurePackage({ feature: "agents", role: "server", layoutVersion: 0 });
    write(
      "packages/features/agents/server/src/services/agent.service.ts",
      "export class AgentService { static create() { return new AgentService(); } }",
    );
    write(
      "packages/features/agents/server/src/repositories/agent.repository.ts",
      "export abstract class AgentRepository {}",
    );
    write(
      "packages/features/agents/server/src/repositories/prisma/prisma.agent.repository.ts",
      "export class PrismaAgentRepository { static create() { return new PrismaAgentRepository(); } }",
    );
    write(
      "packages/features/agents/server/src/api/internal/agent.api.ts",
      "export class AgentApi { static create() { return new AgentApi(); } }",
    );

    expect(policies()).not.toContain("feature-source-layout");
  });

  /** @scenario Unknown or missing layout versions fail */
  it("rejects a missing or unknown layout version", () => {
    featurePackage({ feature: "agents", role: "contract" });
    rmSync(join(root, "packages/features/agents/feature.json"));
    expect(policies()).toContain("feature-source-layout");

    write(
      "packages/features/agents/feature.json",
      JSON.stringify({ layoutVersion: 99 }),
    );
    expect(policies()).toContain("feature-source-layout");
  });

  /** @scenario Server artifacts have canonical homes and names */
  it("rejects unknown server layers and non-canonical adapter names", () => {
    featurePackage({ feature: "agents", role: "server", layoutVersion: 0 });
    write(
      "packages/features/agents/server/src/services/agent.service.ts",
      "export class AgentService {}",
    );
    write(
      "packages/features/agents/server/src/composition/agent.runtime.ts",
      "export const runtime = true;",
    );
    write(
      "packages/features/agents/server/src/repositories/prisma/prisma-agent.repository.ts",
      "export class PrismaAgentRepository {}",
    );

    const layoutPolicies = policies().filter(
      (policy) => policy === "feature-source-layout",
    );
    expect(layoutPolicies).toHaveLength(2);
  });

  /** @scenario Contract artifacts remain portable and named */
  it("rejects bare contract artifact names and server artifacts", () => {
    featurePackage({ feature: "agents", role: "contract", layoutVersion: 0 });
    write(
      "packages/features/agents/contract/src/service.ts",
      "export abstract class AgentService {}",
    );
    write(
      "packages/features/agents/contract/src/agent.repository.ts",
      "export abstract class AgentRepository {}",
    );

    const layoutPolicies = policies().filter(
      (policy) => policy === "feature-source-layout",
    );
    expect(layoutPolicies.length).toBeGreaterThanOrEqual(2);
  });
});

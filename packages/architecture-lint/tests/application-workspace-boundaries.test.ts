import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectLegacyApplicationBoundaryEdges,
  discoverClassifiedPackages,
  formatLegacyApplicationBoundaryBaseline,
  lintWorkspace,
} from "../src";
import type {
  ApplicationPackageRole,
  ArchitectureViolation,
  EnterpriseCompositionRole,
} from "../src";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-application-boundaries-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function writeManifest(
  path: string,
  value: {
    name: string;
    private?: boolean;
    license?: string;
    dependencies?: Record<string, string>;
    exports?: Record<string, string>;
  },
): void {
  write(
    path,
    JSON.stringify({
      type: "module",
      exports: { ".": "./src/index.ts" },
      ...value,
    }),
  );
}

const APPLICATION_NAMES: Record<ApplicationPackageRole, string> = {
  ui: "@langwatch/ui",
  api: "@langwatch/platform-api",
  worker: "@langwatch/worker",
  server: "@langwatch/server",
};

function application(
  role: ApplicationPackageRole,
  options: {
    source?: string;
    dependencies?: Record<string, string>;
    exports?: Record<string, string>;
  } = {},
): void {
  writeManifest(`apps/${role}/package.json`, {
    name: APPLICATION_NAMES[role],
    dependencies: options.dependencies,
    exports: options.exports,
  });
  write(`apps/${role}/src/index.ts`, options.source ?? "export {};");
}

const ENTERPRISE_COMPOSITION_NAMES: Record<EnterpriseCompositionRole, string> = {
  api: "@langwatch/enterprise-api",
  worker: "@langwatch/enterprise-worker",
};

function enterpriseComposition(
  role: EnterpriseCompositionRole,
  dependencies: Record<string, string> = {},
): void {
  writeManifest(`packages/enterprise/composition/${role}/package.json`, {
    name: ENTERPRISE_COMPOSITION_NAMES[role],
    dependencies,
  });
  const className = `${role[0]?.toUpperCase()}${role.slice(1)}Composition`;
  write(
    `packages/enterprise/composition/${role}/src/index.ts`,
    `export class ${className} { static create() { return new ${className}(); } }`,
  );
}

function enterpriseFeature(feature: string, role: "contract" | "server" | "web"): void {
  const featureRoot = `packages/enterprise/features/${feature}`;
  write(`${featureRoot}/feature.json`, JSON.stringify({ layoutVersion: 0 }));
  writeManifest(`${featureRoot}/${role}/package.json`, {
    name: `@langwatch/enterprise-${feature}-${role}`,
    dependencies: role === "contract" ? { zod: "^4.4.3" } : undefined,
  });
  write(`${featureRoot}/${role}/src/index.ts`, "export {};");
}

function enterpriseRoot(): void {
  write("packages/enterprise/LICENSE.md", "# LangWatch Enterprise License\n");
  write("packages/enterprise/README.md", "# LangWatch Enterprise\n");
  writeManifest("packages/enterprise/package.json", {
    name: "@langwatch/enterprise",
    license: "SEE LICENSE IN LICENSE.md",
  });
  write("packages/enterprise/src/index.ts", "export {};");
}

function violations(): ArchitectureViolation[] {
  return lintWorkspace({ root, declarations: false });
}

function policy(name: string): ArchitectureViolation[] {
  return violations().filter((violation) => violation.policy === name);
}

describe("application workspace classification", () => {
  it("classifies the four fixed application paths and names", () => {
    for (const role of ["ui", "api", "worker", "server"] as const) {
      application(role);
    }

    const discovery = discoverClassifiedPackages(root);
    expect(
      discovery.packages
        .filter((pkg) => pkg.kind === "application")
        .map((pkg) => [pkg.applicationRole, pkg.name]),
    ).toEqual([
      ["ui", "@langwatch/ui"],
      ["api", "@langwatch/platform-api"],
      ["worker", "@langwatch/worker"],
      ["server", "@langwatch/server"],
    ]);
  });

  it("rejects a wrong fixed name and any apps/shared directory", () => {
    writeManifest("apps/ui/package.json", { name: "@langwatch/frontend" });
    write("apps/ui/src/index.ts", "export {};");
    write("apps/shared/src/index.ts", "export {};");

    expect(policy("application-layout")).toHaveLength(2);
  });

  it("uses the repository application ADR instead of requiring duplicate local records", () => {
    application("server");

    expect(policy("architecture-record")).toEqual([]);
  });

  it("rejects manifest and relative source dependencies between apps", () => {
    application("api", { source: "export const runtime = true;" });
    application("ui", {
      dependencies: { "@langwatch/platform-api": "workspace:*" },
      source: 'import { runtime } from "../../api/src/index"; export { runtime };',
    });

    expect(policy("application-boundary").length).toBeGreaterThanOrEqual(2);
  });
});

describe("combined contributor runtime", () => {
  function runtimeApplications(): void {
    application("api", {
      exports: {
        ".": "./src/index.ts",
        "./runtime": "./src/runtime.ts",
      },
    });
    write("apps/api/src/runtime.ts", "export const apiRuntime = true;");
    application("worker", {
      exports: {
        ".": "./src/index.ts",
        "./runtime": "./src/runtime.ts",
      },
    });
    write("apps/worker/src/runtime.ts", "export const workerRuntime = true;");
  }

  it("allows the private dev runtime to import both deliberate runtime exports", () => {
    runtimeApplications();
    writeManifest("tools/dev-runtime/package.json", {
      name: "@langwatch/dev-runtime",
      private: true,
    });
    write(
      "tools/dev-runtime/src/index.ts",
      'import { apiRuntime } from "@langwatch/platform-api/runtime"; import { workerRuntime } from "@langwatch/worker/runtime"; export { apiRuntime, workerRuntime };',
    );

    expect(policy("application-layout")).toEqual([]);
    expect(policy("application-boundary")).toEqual([]);
    expect(policy("composition-source")).toEqual([]);
  });

  it("rejects a non-private dev runtime and product implementation modules", () => {
    runtimeApplications();
    writeManifest("tools/dev-runtime/package.json", {
      name: "@langwatch/dev-runtime",
      private: false,
    });
    write(
      "tools/dev-runtime/src/index.ts",
      'import "@langwatch/platform-api/runtime"; import "@langwatch/worker/runtime";',
    );
    write("tools/dev-runtime/src/services/product.service.ts", "export class ProductService {}");

    expect(policy("application-layout")).toHaveLength(1);
    expect(policy("composition-source")).toHaveLength(1);
  });

  it("rejects every other tool that combines both runtime exports", () => {
    runtimeApplications();
    writeManifest("tools/scripts/package.json", {
      name: "@langwatch/scripts",
      private: true,
    });
    write(
      "tools/scripts/src/index.ts",
      'import "@langwatch/platform-api/runtime"; import "@langwatch/worker/runtime";',
    );

    expect(policy("application-boundary")).toEqual([
      expect.objectContaining({ file: "tools/scripts/src" }),
    ]);
  });
});

describe("Enterprise aggregate boundaries", () => {
  it("accepts fixed packages, compatible feature surfaces, and matching apps", () => {
    enterpriseRoot();
    enterpriseFeature("billing", "contract");
    enterpriseFeature("billing", "server");
    enterpriseFeature("billing", "web");
    enterpriseComposition("api", {
      "@langwatch/enterprise-billing-contract": "workspace:*",
      "@langwatch/enterprise-billing-server": "workspace:*",
    });
    enterpriseComposition("worker", {
      "@langwatch/enterprise-billing-server": "workspace:*",
    });
    application("api", {
      dependencies: { "@langwatch/enterprise-api": "workspace:*" },
    });
    application("worker", {
      dependencies: { "@langwatch/enterprise-worker": "workspace:*" },
    });

    const relevant = violations().filter((violation) =>
      [
        "enterprise-layout",
        "enterprise-license",
        "enterprise-composition",
        "composition-source",
      ].includes(violation.policy),
    );
    expect(relevant).toEqual([]);
  });

  it("rejects cross-composition, incompatible surface, and mismatched app dependencies", () => {
    enterpriseRoot();
    enterpriseFeature("billing", "web");
    enterpriseComposition("worker");
    enterpriseComposition("api", {
      "@langwatch/enterprise-worker": "workspace:*",
      "@langwatch/enterprise-billing-web": "workspace:*",
    });
    application("ui", {
      dependencies: { "@langwatch/enterprise-api": "workspace:*" },
    });

    expect(policy("enterprise-composition").length).toBeGreaterThanOrEqual(3);
  });

  it("requires the governing license and rejects Apache descendant metadata", () => {
    enterpriseFeature("billing", "contract");
    write("packages/enterprise/README.md", "# LangWatch Enterprise\n");
    write(
      "packages/enterprise/features/billing/contract/package.json",
      JSON.stringify({
        name: "@langwatch/enterprise-billing-contract",
        type: "module",
        exports: { ".": "./src/index.ts" },
        license: "Apache-2.0",
        dependencies: { zod: "^4.4.3" },
      }),
    );

    expect(policy("enterprise-layout")).toHaveLength(1);
    expect(policy("enterprise-license")).toHaveLength(1);
  });

  it("keeps the root portable and composition packages class based", () => {
    enterpriseRoot();
    writeManifest("packages/enterprise/package.json", {
      name: "@langwatch/enterprise",
      license: "SEE LICENSE IN LICENSE.md",
      dependencies: { react: "19.2.4" },
    });
    write("packages/enterprise/src/index.ts", 'import React from "react"; export { React };');
    writeManifest("packages/enterprise/composition/api/package.json", {
      name: "@langwatch/enterprise-api",
    });
    write("packages/enterprise/composition/api/src/index.ts", "export const create = () => ({});");

    expect(policy("enterprise-composition")).toHaveLength(2);
    expect(policy("composition-source")).toHaveLength(1);
  });
});

describe("shrinking legacy application boundary baseline", () => {
  const baselinePath = "packages/architecture-lint/src/legacy-application-boundary-baseline.json";

  function legacyBrowserEdge(): void {
    write(
      "platform/app/src/components/view.ts",
      'import type { Value } from "~/server/value"; export type View = Value;',
    );
    write("platform/app/src/server/value.ts", "export type Value = string;");
  }

  it("rejects a current legacy edge until its exact record is checked in", () => {
    legacyBrowserEdge();
    const edges = collectLegacyApplicationBoundaryEdges(root);

    expect(edges).toEqual([
      {
        importer: "platform/app/src/components/view.ts",
        specifier: "~/server/value",
        kind: "browser-to-backend",
      },
    ]);
    expect(policy("application-migration")).toHaveLength(1);

    write(baselinePath, formatLegacyApplicationBoundaryBaseline(edges));
    expect(policy("application-migration")).toEqual([]);
    expect(policy("application-migration-baseline")).toEqual([]);
  });

  it("keeps legacy baseline reconciliation out of routine lint", () => {
    legacyBrowserEdge();

    const routine = lintWorkspace({
      root,
      declarations: false,
      legacyApplicationMigration: false,
    });

    expect(
      routine.filter((violation) => violation.policy.startsWith("application-migration")),
    ).toEqual([]);
  });

  it("fails when a removed edge leaves a stale baseline entry", () => {
    legacyBrowserEdge();
    const edges = collectLegacyApplicationBoundaryEdges(root);
    write(baselinePath, formatLegacyApplicationBoundaryBaseline(edges));
    write("platform/app/src/components/view.ts", "export type View = string;");

    expect(policy("application-migration-baseline")).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("must be removed"),
      }),
    ]);
  });

  it("rejects new @ee aliases outside the legacy application", () => {
    application("ui", {
      source: 'import { value } from "@ee/licensing/value"; export { value };',
    });

    expect(policy("application-migration")).toHaveLength(1);
  });

  it("requires the baseline file to disappear after its final edge", () => {
    write(baselinePath, formatLegacyApplicationBoundaryBaseline([]));

    expect(policy("application-migration-baseline")).toEqual([
      expect.objectContaining({ message: expect.stringContaining("deleted") }),
    ]);
  });
});

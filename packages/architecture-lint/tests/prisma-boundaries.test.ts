import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintPrismaBoundaries } from "../src/prisma-boundaries";
import type { ClassifiedPackage } from "../src/types";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prisma-boundaries-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function applicationPackage(name: string, relativeRoot: string): ClassifiedPackage {
  return {
    name,
    root: join(root, relativeRoot),
    manifestPath: join(root, relativeRoot, "package.json"),
    manifest: { name },
    kind: "application",
    enterprise: false,
  };
}

function enterpriseCompositionPackage(name: string, relativeRoot: string): ClassifiedPackage {
  return {
    name,
    root: join(root, relativeRoot),
    manifestPath: join(root, relativeRoot, "package.json"),
    manifest: { name },
    kind: "enterprise-composition",
    enterprise: true,
  };
}

describe("prisma-containment on composition roots", () => {
  it("allows a *.composition.ts file to import type PrismaClient", () => {
    write(
      "apps/api/src/app/api-usage.composition.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\n' +
        "export function build(client: PrismaClient) { return client; }\n",
    );

    const violations = lintPrismaBoundaries([
      applicationPackage("@langwatch/platform-api", "apps/api"),
    ]);

    expect(violations).toEqual([]);
  });

  it("allows a *.mount.ts and platform/infrastructure/** file in an application to import PrismaClient", () => {
    write(
      "apps/api/src/features/enterprise/enterprise-billing-trpc.mount.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\n' +
        "export function mount(client: PrismaClient) { return client; }\n",
    );
    write(
      "apps/api/src/platform/infrastructure/api-database.infrastructure.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\n' +
        "export function build(client: PrismaClient) { return client; }\n",
    );

    const violations = lintPrismaBoundaries([
      applicationPackage("@langwatch/platform-api", "apps/api"),
    ]);

    expect(violations).toEqual([]);
  });

  it("allows an enterprise-composition package's *.adapter.ts to import PrismaClient", () => {
    write(
      "packages/enterprise/composition/api/src/governance/gateway-debit.adapter.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\n' +
        "export function build(client: PrismaClient) { return client; }\n",
    );

    const violations = lintPrismaBoundaries([
      enterpriseCompositionPackage(
        "@langwatch/enterprise-api",
        "packages/enterprise/composition/api",
      ),
    ]);

    expect(violations).toEqual([]);
  });

  it("still fails a non-composition application file that imports PrismaClient", () => {
    write(
      "apps/api/src/features/evaluation/custom-evaluators.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\n' +
        "export function build(client: PrismaClient) { return client; }\n",
    );

    const violations = lintPrismaBoundaries([
      applicationPackage("@langwatch/platform-api", "apps/api"),
    ]);

    expect(violations).toMatchObject([
      {
        policy: "prisma-containment",
        file: join(root, "apps/api/src/features/evaluation/custom-evaluators.ts"),
      },
    ]);
  });

  it("still fails a feature service naming PrismaClient", () => {
    write(
      "packages/features/trace/server/src/services/trace-legacy-read.service.ts",
      'import type { PrismaClient } from "@langwatch/prisma-client/generated";\n' +
        "export function build(client: PrismaClient) { return client; }\n",
    );

    const violations = lintPrismaBoundaries([
      {
        name: "@langwatch/trace-server",
        root: join(root, "packages/features/trace/server"),
        manifestPath: join(root, "packages/features/trace/server/package.json"),
        manifest: { name: "@langwatch/trace-server" },
        kind: "server",
        feature: "trace",
        enterprise: false,
      },
    ]);

    expect(violations).toMatchObject([
      {
        policy: "prisma-containment",
        file: join(
          root,
          "packages/features/trace/server/src/services/trace-legacy-read.service.ts",
        ),
      },
    ]);
  });
});

/**
 * The package layout and the one-row persistence promise, read off the tree.
 * @vitest-environment node
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PROCESS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FEATURE_ROOT = path.resolve(PROCESS_ROOT, "..");
const REPO_ROOT = path.resolve(FEATURE_ROOT, "..", "..");

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["__tests__", "node_modules", "dist"].includes(entry.name)
        ? []
        : productionSources(entryPath);
    }
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [entryPath] : [];
  });
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

function applicationPackageNames(): string[] {
  const appsRoot = path.join(REPO_ROOT, "apps");
  return readdirSync(appsRoot)
    .map((name) => path.join(appsRoot, name, "package.json"))
    .filter((manifest) => existsSync(manifest))
    .map((manifest) => (JSON.parse(readFileSync(manifest, "utf8")) as { name: string }).name);
}

function packageManifest(half: "contract" | "process") {
  return JSON.parse(readFileSync(path.join(FEATURE_ROOT, half, "package.json"), "utf8")) as {
    name: string;
    dependencies?: Record<string, string>;
  };
}

describe("the Stored Objects feature packages", () => {
  /** @scenario Stored Objects lives in one feature package */
  it("keeps portable contracts in the contract half and the concrete store in the process half", () => {
    expect(
      readdirSync(FEATURE_ROOT)
        .filter((name) => ["contract", "process", "browser", "client"].includes(name))
        .toSorted(),
    ).toEqual(["contract", "process"]);
    expect(packageManifest("contract").name).toBe("@langwatch/stored-object-contract");
    expect(packageManifest("process").name).toBe("@langwatch/stored-object-process");

    for (const portable of [
      "stored-object.errors.ts",
      "stored-object.trpc.ts",
      "stored-object.api.ts",
    ]) {
      expect(existsSync(path.join(FEATURE_ROOT, "contract", "src", portable))).toBe(true);
    }
    for (const concrete of [
      "services/stored-object.service.ts",
      "migrations/clickhouse-import.stored-object.migration.ts",
      "repositories/prisma/prisma.stored-object-record.repository.ts",
      "stored-object.module.ts",
    ]) {
      expect(existsSync(path.join(PROCESS_ROOT, "src", concrete))).toBe(true);
    }
  });

  /** @scenario Stored Objects lives in one feature package */
  it("lets neither package depend on or import an application", () => {
    const applications = applicationPackageNames();
    expect(applications.length).toBeGreaterThan(0);

    for (const half of ["contract", "process"] as const) {
      const manifest = packageManifest(half);
      expect(
        Object.keys(manifest.dependencies ?? {}).filter((name) => applications.includes(name)),
      ).toEqual([]);

      const offences = productionSources(path.join(FEATURE_ROOT, half, "src")).flatMap((file) =>
        importSpecifiers(file)
          .filter((specifier) =>
            applications.some((app) => specifier === app || specifier.startsWith(`${app}/`)),
          )
          .map((specifier) => `${path.relative(REPO_ROOT, file)} imports ${specifier}`),
      );
      expect(offences).toEqual([]);
    }
  });
});

describe("the Stored Objects persistence", () => {
  /** @scenario One Postgres row owns current state */
  it("owns one Postgres table, StoredObject, holding the row's tenant, status, owner, provider identity, byte facts and expiry", () => {
    const schema = readFileSync(
      path.join(REPO_ROOT, "packages", "prisma-client", "prisma", "schema.prisma"),
      "utf8",
    );
    const models = [...schema.matchAll(/^model (\w*StoredObject\w*) \{([\s\S]*?)^\}/gm)];
    expect(models.map((model) => model[1])).toEqual(["StoredObject"]);

    const columns = (models[0]?.[2] ?? "")
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0] ?? "");
    expect(columns).toEqual(
      expect.arrayContaining([
        "tenantId",
        "id",
        "status",
        "ownerKind",
        "ownerId",
        "storageProviderRelativeId",
        "sha256",
        "sizeBytes",
        "mediaType",
        "expiresAt",
        "availableAt",
        "deletedAt",
      ]),
    );
  });

  /** @scenario One Postgres row owns current state */
  it("reaches the row through one repository interface with a Prisma and a memory backend, and keeps no event lifecycle", () => {
    const repositories = path.join(PROCESS_ROOT, "src", "repositories");
    expect(
      readFileSync(path.join(repositories, "stored-object-record.repository.ts"), "utf8"),
    ).toMatch(/export interface StoredObjectRecordRepository\b/);
    expect(
      readFileSync(
        path.join(repositories, "prisma", "prisma.stored-object-record.repository.ts"),
        "utf8",
      ),
    ).toMatch(
      /class PrismaStoredObjectRecordRepository[\s\S]*?implements StoredObjectRecordRepository/,
    );
    expect(
      readFileSync(
        path.join(repositories, "memory", "memory.stored-object-record.repository.ts"),
        "utf8",
      ),
    ).toMatch(/class MemoryStoredObjectRecordRepository implements StoredObjectRecordRepository/);
    expect(
      readFileSync(path.join(PROCESS_ROOT, "src", "services", "stored-object.service.ts"), "utf8"),
    ).toMatch(/export class StoredObjectService\b/);
    expect(existsSync(path.join(PROCESS_ROOT, "src", "eventing"))).toBe(false);
  });
});

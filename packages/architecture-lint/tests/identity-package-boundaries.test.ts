import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-115's boundaries as graph facts (packages/features/identity/specs/package-boundary.feature).
 * A folder cannot fail to resolve; a package can, and this test is where
 * the app states what each package may reach and what only the runtime may
 * construct. Deliberately a plain text scan over the sources: an import is
 * a line, and a `new IdentityService(` is a line, and a test that reads the
 * same lines a reviewer would is the one that keeps saying the same thing.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// The API process is the composition root now. The platform application was
// the one that composed identity when this guard was written, and it is gone.
const APP_SRC = join(REPO_ROOT, "apps", "api", "src");
const IDENTITY_SRC = join(REPO_ROOT, "packages", "features", "identity", "contract", "src");
const IDENTITY_SERVER_SRC = join(
  REPO_ROOT,
  "packages",
  "features",
  "identity",
  "server",
  "src",
);
const IDENTITY_EVENTING_SRC = join(
  REPO_ROOT,
  "packages",
  "identity-eventing",
  "src",
);

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== "__tests__" && entry !== "node_modules") walk(path);
        continue;
      }
      if (path.endsWith(".ts") && !path.endsWith(".test.ts")) files.push(path);
    }
  };
  walk(root);
  return files;
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [
    ...source.matchAll(
      /^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm,
    ),
  ].map((match) => match[1] as string);
}

/**
 * The app and the storage engines, for every identity package.
 *
 * `event-sourcing` is the path the framework had while it lived in
 * `platform/app`; `@langwatch/eventing` is its package name, and it is listed
 * separately because the old pattern silently stopped matching when the
 * framework became a package — a guard that reads as enforcing "no framework"
 * while matching nothing at all.
 */
const FORBIDDEN_FOR_EVERY_IDENTITY_PACKAGE = [
  /^~\//,
  /^@prisma\//,
  /^\.prisma\//,
  /prisma\/client/,
];

/** …plus the framework, for the two packages that must never reach it. */
const FORBIDDEN_FRAMEWORK = [/event-sourcing/, /^@langwatch\/eventing(?:\/|$)/];

const FORBIDDEN_FOR_BOTH = [
  ...FORBIDDEN_FOR_EVERY_IDENTITY_PACKAGE,
  ...FORBIDDEN_FRAMEWORK,
];

describe("identity package boundaries", () => {
  describe("when the pure core's sources are scanned", () => {
    /** @scenario "The pure identity core compiles without node types" */
    it("import no node built-in, Prisma, the app, or the event-sourcing framework", () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(IDENTITY_SRC)) {
        for (const specifier of importSpecifiers(file)) {
          const forbidden =
            specifier.startsWith("node:") ||
            FORBIDDEN_FOR_BOTH.some((pattern) => pattern.test(specifier));
          if (forbidden)
            offenders.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  /**
   * Seven files in `@langwatch/identity-server` import `@langwatch/eventing`
   * directly, which ADR-115 says only `@langwatch/identity-eventing` may do.
   *
   * They are listed rather than allowed. This guard lived in the platform
   * application, whose whole suite was red, so nothing read what it said; the
   * violations are older than this file's move and none of them was introduced
   * by it. Recorded as a baseline so the rule keeps biting on the eighth file
   * while the identity lane decides between moving these adapters behind
   * `identity-eventing` and amending the ADR. Shrink this list when they land;
   * never add to it.
   */
  const EVENTING_IMPORT_BASELINE = [
    "packages/features/identity/server/src/adapters/eventing.scim-sync-ledger.adapter.ts -> @langwatch/eventing",
    "packages/features/identity/server/src/adapters/identity-ledger.adapter.ts -> @langwatch/eventing",
    "packages/features/identity/server/src/adapters/join-request-ledger.adapter.ts -> @langwatch/eventing",
    "packages/features/identity/server/src/repositories/prisma/prisma.identity-projection.repository.ts -> @langwatch/eventing",
    "packages/features/identity/server/src/repositories/prisma/prisma.join-request-projection.repository.ts -> @langwatch/eventing",
    "packages/features/identity/server/src/repositories/prisma/prisma.mfa-enrollment-projection.repository.ts -> @langwatch/eventing",
    "packages/features/identity/server/src/repositories/prisma/prisma.scim-sync-projection.repository.ts -> @langwatch/eventing",
  ];

  describe("when the server runtime's sources are scanned", () => {
    /** @scenario "The identity server runtime reads no storage engine and no environment" */
    it("import no Prisma, the app, or the event-sourcing framework, and read no process.env", () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(IDENTITY_SERVER_SRC)) {
        for (const specifier of importSpecifiers(file)) {
          if (FORBIDDEN_FOR_BOTH.some((pattern) => pattern.test(specifier))) {
            offenders.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
          }
        }
        if (/process\.env/.test(readFileSync(file, "utf8"))) {
          offenders.push(`${relative(REPO_ROOT, file)} reads process.env`);
        }
      }
      expect(offenders.sort()).toEqual(EVENTING_IMPORT_BASELINE);
    });
  });

  describe("when the event-sourcing layer's sources are scanned", () => {
    /** @scenario "The identity event-sourcing layer reads no storage engine and no environment" */
    it("import no Prisma and no app, and read no process.env", () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(IDENTITY_EVENTING_SRC)) {
        for (const specifier of importSpecifiers(file)) {
          if (
            FORBIDDEN_FOR_EVERY_IDENTITY_PACKAGE.some((pattern) =>
              pattern.test(specifier),
            )
          ) {
            offenders.push(`${relative(REPO_ROOT, file)} -> ${specifier}`);
          }
        }
        if (/process\.env/.test(readFileSync(file, "utf8"))) {
          offenders.push(`${relative(REPO_ROOT, file)} reads process.env`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe("when the API process's sources are scanned", () => {
    /** @scenario "The app composes the identity services in exactly one place" */
    it("construct IdentityService only in the identity composition", () => {
      const constructors: string[] = [];
      for (const file of sourceFiles(APP_SRC)) {
        if (/new IdentityService\(/.test(readFileSync(file, "utf8"))) {
          constructors.push(relative(APP_SRC, file));
        }
      }
      expect(constructors).toEqual(["app/api-trpc-collaborators.identity.composition.ts"]);
    });

  });
});

/**
 * @vitest-environment node
 *
 * scripts/check-openapi-route-coverage.ts.
 *
 * The gate exists because an undocumented route is invisible from every angle
 * except this one: it serves traffic, the SDKs call it, and the API reference
 * simply has no page for it. So the tests pin both directions — an unexplained
 * gap has to fail, and an exclusion that no longer explains anything has to
 * fail too, or the list stops describing the codebase and the gate goes quiet
 * on exactly the drift it was written to catch.
 *
 * The last block asserts against the real `UNPUBLISHED` list rather than a
 * fixture, because a duplicate or a mis-shaped entry there is a live defect,
 * not a hypothetical one.
 */

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  auditCoverage,
  collectRegisteredRoutes,
  documentedOperations,
  excludes,
  HANDLER_ROOTS,
  isEntryModule,
  type RegisteredRoute,
} from "../check-openapi-route-coverage";
import {
  apiBasePathsOf,
  collectRouteRegistrations,
  honoPathToTemplate,
  joinRoutePath,
  serviceBasePathsOf,
} from "../lib/hono-route-table";
import { type Exclusion, UNPUBLISHED } from "../openapi-route-exclusions";

const route = ({
  key,
  described = false,
  withdrawn,
}: {
  key: string;
  described?: boolean;
  withdrawn?: boolean;
}): RegisteredRoute => ({
  key,
  file: "src/server/routes/example.ts",
  described,
  ...(withdrawn === undefined ? {} : { withdrawn }),
});

const audit = ({
  routes,
  documented = [],
  exclusions = [],
}: {
  routes: RegisteredRoute[];
  documented?: string[];
  exclusions?: Exclusion[];
}) =>
  auditCoverage({
    routes,
    documented: new Set(documented),
    exclusions,
  });

describe("documentedOperations", () => {
  it("keys every method of every path the document describes", () => {
    const operations = documentedOperations({
      paths: {
        "/api/experiments": { get: {} },
        "/api/experiments/{slug}/run": { post: {} },
      },
    });

    expect([...operations].sort()).toEqual([
      "GET /api/experiments",
      "POST /api/experiments/{slug}/run",
    ]);
  });

  it("ignores keys that are not HTTP methods", () => {
    const operations = documentedOperations({
      paths: { "/api/experiments": { get: {}, parameters: [], summary: "x" } },
    });

    expect([...operations]).toEqual(["GET /api/experiments"]);
  });
});

describe("excludes", () => {
  describe("when the entry names one operation", () => {
    it("matches only that method and path", () => {
      const entry: Exclusion = {
        match: "POST /api/experiments/execute",
        category: "internal",
        why: "session authenticated",
      };

      expect(
        excludes({ exclusion: entry, key: "POST /api/experiments/execute" }),
      ).toBe(true);
      expect(
        excludes({ exclusion: entry, key: "GET /api/experiments/execute" }),
      ).toBe(false);
    });
  });

  describe("when the entry names a prefix", () => {
    it("matches the prefix itself and everything beneath it", () => {
      const entry: Exclusion = {
        match: "/api/trpc",
        category: "internal",
        why: "the app's own transport",
      };

      expect(excludes({ exclusion: entry, key: "GET /api/trpc" })).toBe(true);
      expect(
        excludes({ exclusion: entry, key: "POST /api/trpc/experiment.create" }),
      ).toBe(true);
    });

    it("does not match a sibling path that merely shares a word start", () => {
      const entry: Exclusion = {
        match: "/api/experiment",
        category: "internal",
        why: "example",
      };

      expect(excludes({ exclusion: entry, key: "GET /api/experiments" })).toBe(
        false,
      );
    });
  });
});

describe("auditCoverage", () => {
  describe("when a registered route is absent from the document", () => {
    /** @scenario "A public route missing from the document fails the check" */
    it("reports it as unexplained", () => {
      const result = audit({
        routes: [route({ key: "POST /api/experiment/init" })],
      });

      expect(result.unexplained.map((r) => r.key)).toEqual([
        "POST /api/experiment/init",
      ]);
    });

    /** @scenario "An internal route is excluded by a written reason" */
    it("stays silent once an exclusion explains it", () => {
      const result = audit({
        routes: [route({ key: "POST /api/experiments/execute" })],
        exclusions: [
          {
            match: "POST /api/experiments/execute",
            category: "internal",
            why: "session authenticated",
          },
        ],
      });

      expect(result.unexplained).toEqual([]);
      expect(result.stale).toEqual([]);
    });
  });

  describe("when a route is in the document", () => {
    it("neither reports it nor counts it as unexplained", () => {
      const result = audit({
        routes: [route({ key: "GET /api/experiments" })],
        documented: ["GET /api/experiments"],
      });

      expect(result.unexplained).toEqual([]);
      expect(result.documented).toBe(1);
      expect(result.registered).toBe(1);
    });
  });

  describe("when an exclusion explains nothing", () => {
    /** @scenario "An exclusion that no longer suppresses anything fails the check" */
    it("reports the entry as stale", () => {
      const stale: Exclusion = {
        match: "POST /api/gone",
        category: "gap",
        why: "deleted last quarter",
      };

      const result = audit({
        routes: [route({ key: "GET /api/experiments" })],
        documented: ["GET /api/experiments"],
        exclusions: [stale],
      });

      expect(result.stale).toEqual([stale]);
    });

    it("counts an entry as used only when the route is actually missing", () => {
      const entry: Exclusion = {
        match: "GET /api/experiments",
        category: "gap",
        why: "not published yet",
      };

      const result = audit({
        routes: [route({ key: "GET /api/experiments" })],
        documented: ["GET /api/experiments"],
        exclusions: [entry],
      });

      expect(result.stale).toEqual([entry]);
    });
  });

  describe("when the same route is registered from two basePaths", () => {
    it("counts each spelling once", () => {
      const result = audit({
        routes: [
          route({ key: "GET /api/experiments" }),
          route({ key: "GET /api/experiments" }),
        ],
        documented: ["GET /api/experiments"],
      });

      expect(result.registered).toBe(1);
    });
  });

  describe("when a registered route is a withdrawn tombstone", () => {
    /** @scenario "A withdrawn endpoint is accounted for without an exclusion entry" */
    it("accounts for it without asking for an exclusion entry", () => {
      // A withdrawn endpoint answers 410 and has no handler behind it, so
      // there is nothing for the generator to describe and no way to publish
      // it. Demanding a written reason would ask an author to explain the one
      // thing the route's own shape already says.
      const result = audit({
        routes: [route({ key: "GET /api/roles/{id}/legacy", withdrawn: true })],
      });

      expect(result.unexplained).toEqual([]);
      expect(result.withdrawn.map((r) => r.key)).toEqual([
        "GET /api/roles/{id}/legacy",
      ]);
      expect(result.stale).toEqual([]);
    });

    it("still counts it as a registered route", () => {
      const result = audit({
        routes: [route({ key: "GET /api/roles/{id}/legacy", withdrawn: true })],
      });

      expect(result.registered).toBe(1);
      expect(result.documented).toBe(0);
    });

    it("leaves it out of the bucket once an exclusion already explains it", () => {
      const entry: Exclusion = {
        match: "/api/roles",
        category: "internal",
        why: "example",
      };

      const result = audit({
        routes: [route({ key: "GET /api/roles/{id}/legacy", withdrawn: true })],
        exclusions: [entry],
      });

      expect(result.withdrawn).toEqual([]);
      expect(result.stale).toEqual([]);
    });
  });

  describe("when a version registers a route a later one withdraws", () => {
    it("treats the shared key as withdrawn", () => {
      // The bare alias serves the last resolution of a path, so the withdrawal
      // is what a caller meets there. Keeping the first registration's answer
      // would report a 410 as an undocumented live endpoint.
      const result = audit({
        routes: [
          route({ key: "GET /api/roles/{id}", described: true }),
          route({ key: "GET /api/roles/{id}", withdrawn: true }),
        ],
      });

      expect(result.unexplained).toEqual([]);
      expect(result.withdrawn.map((r) => r.key)).toEqual([
        "GET /api/roles/{id}",
      ]);
    });

    it("treats it as live again when a later version re-registers it", () => {
      const result = audit({
        routes: [
          route({ key: "GET /api/roles/{id}" }),
          route({ key: "GET /api/roles/{id}", withdrawn: true }),
          route({ key: "GET /api/roles/{id}" }),
        ],
      });

      expect(result.withdrawn).toEqual([]);
      expect(result.unexplained.map((r) => r.key)).toEqual([
        "GET /api/roles/{id}",
      ]);
    });
  });

  /** @scenario "A route annotated but whose app is unwired is still caught" */
  it("catches an annotated route whose app the generator never imports", () => {
    const result = audit({
      routes: [
        route({ key: "GET /api/projects/{id}/api-key", described: true }),
      ],
    });

    expect(result.unexplained.map((r) => r.key)).toEqual([
      "GET /api/projects/{id}/api-key",
    ]);
    // The flag is what lets the report say which of the three publishing steps
    // was skipped, rather than leaving the reader to guess.
    expect(result.unexplained[0]?.described).toBe(true);
  });
});

describe("collectRegisteredRoutes", () => {
  describe("given a file whose routes are registered against a sibling's app", () => {
    /** @scenario "Routes registered in a file with no basePath are still counted" */
    it("finds them under the sibling's basePath", () => {
      // The seven `app.v1.ts` files export a register function that their
      // sibling `app.ts` calls; they declare no basePath of their own. Reading
      // only what a file declares skipped every route in them.
      const routes = collectRegisteredRoutes(HANDLER_ROOTS);
      const fromV1 = routes.filter((route) => route.file.endsWith("app.v1.ts"));

      expect(fromV1.length).toBeGreaterThan(0);
      for (const route of fromV1) {
        expect(route.key).toMatch(/^[A-Z]+ \/api\//);
      }
    });

    it("gives the prompts v1 surface its real paths", () => {
      const keys = new Set(
        collectRegisteredRoutes(HANDLER_ROOTS).map((route) => route.key),
      );

      expect(keys).toContain("GET /api/prompts");
      // `:id{.+?}` in the source — the constraint has to come off, or this
      // reads as `{id}{.+?}` and matches nothing in the document.
      expect(keys).toContain("GET /api/prompts/{id}");
      expect(keys).toContain("GET /api/prompts/{id}/versions");
    });
  });

  describe("given a service declared through @langwatch/api", () => {
    // Fixtures, not the repo: no production file declares a service this way
    // yet, and the gate has to be able to see the first one that does on the
    // day it lands rather than after someone notices the reference is short.
    let root = "";

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "openapi-route-coverage-"));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    const write = (relative: string, lines: string[]): void => {
      const full = join(root, relative);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, lines.join("\n"), "utf8");
    };

    /** @scenario "A service declaring only its name is counted under its derived prefix" */
    it("counts its routes under the prefix the framework derives", () => {
      // The service says `name: "roles"` and the framework turns that into
      // `/api/roles`. Nothing in the file spells the prefix out, so a parse
      // reading only declared basePaths finds none, skips the file, and every
      // route in it is missing from the reference with nothing to notice.
      write("roles/app.ts", [
        'import { createService } from "@langwatch/api";',
        "",
        'export const app = createService({ name: "roles" })',
        '  .version("2026-08-07", (v) => {',
        '    v.get("/", { output: RoleList }, list);',
        '    v.get("/:id", { output: Role }, read);',
        "  })",
        "  .build();",
      ]);

      expect(collectRegisteredRoutes([root]).map((route) => route.key)).toEqual(
        ["GET /api/roles", "GET /api/roles/{id}"],
      );
    });

    /** @scenario "A versioned registration is counted once at its bare alias path" */
    it("counts a route redeclared across versions once, at its bare path", () => {
      // Every version mounts: `/api/roles/2026-01-01/`, `/api/roles/latest/`
      // and the bare `/api/roles`. Only the bare alias is documented, and it
      // is the only one the source spells, so the route table lands on it
      // without knowing anything about versions.
      write("roles/app.ts", [
        'import { createService } from "@langwatch/api";',
        "",
        'export const app = createService({ name: "roles" })',
        '  .version("2026-01-01", (v) => {',
        '    v.get("/", { output: RoleList }, list);',
        "  })",
        '  .version("2026-08-07", (v) => {',
        '    v.get("/", { output: RoleListV2 }, list);',
        "  })",
        "  .build();",
      ]);

      const routes = collectRegisteredRoutes([root]);

      expect(routes.map((route) => route.key)).toEqual([
        "GET /api/roles",
        "GET /api/roles",
      ]);
      expect(audit({ routes }).registered).toBe(1);
    });

    it("flags the family, so a report can name the fix that family needs", () => {
      write("roles/app.ts", [
        'import { createService } from "@langwatch/api";',
        "",
        'export const app = createService({ name: "roles" })',
        '  .version("2026-08-07", (v) => {',
        '    v.get("/", { output: RoleList }, list);',
        '    v.post("/", { input: NewRole }, create);',
        "  })",
        "  .build();",
      ]);

      const routes = collectRegisteredRoutes([root]);

      expect(
        routes.map((route) => [
          route.key,
          route.described,
          route.usesApiFramework,
        ]),
      ).toEqual([
        ["GET /api/roles", true, true],
        ["POST /api/roles", false, true],
      ]);
    });

    it("carries a withdrawal through to the route table", () => {
      write("roles/app.ts", [
        'import { createService } from "@langwatch/api";',
        "",
        'export const app = createService({ name: "roles" })',
        '  .version("2026-08-07", (v) => {',
        '    v.withdraw("get", "/:id/legacy");',
        "  })",
        "  .build();",
      ]);

      expect(collectRegisteredRoutes([root])).toEqual([
        {
          key: "GET /api/roles/{id}/legacy",
          file: join(root, "roles/app.ts"),
          described: false,
          withdrawn: true,
          usesApiFramework: true,
        },
      ]);
    });

    it("skips a file whose createService is its own local helper", () => {
      write("nurturing.service.unit.ts", [
        'function createService({ region = "us" } = {}) {',
        "  return new NurturingService({ region });",
        "}",
        'const service = createService({ name: "eu" });',
        'service.get("/campaigns", handler);',
      ]);

      expect(collectRegisteredRoutes([root])).toEqual([]);
    });
  });
});

/**
 * Step 3 of publishing, checked the only way a test can check it: from the
 * generator's own source.
 *
 * An app can be imported, merged, and still contribute nothing. `customMerge`
 * only lets an app's paths replace what the JSON already held when the path is
 * owned by an `APP_DERIVED_PREFIXES` entry, so an app whose prefix is absent
 * has its operations quietly union-merged against a stale copy and never
 * pruned. `/api/teams`, `/api/groups` and `/api/model-defaults` all sat in that
 * state: three fully described families, imported and merged, none of them
 * owned.
 *
 * Importing the generator here is not an option. It pulls in every route file
 * in the app, so the check reads it as text, the same way the gate reads the
 * handlers.
 */
const GENERATOR_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/tasks/generateOpenAPISpec.ts",
);

const generatorSource = (): string => readFileSync(GENERATOR_PATH, "utf8");

const appDerivedPrefixes = (source: string): string[] => {
  const block = source.match(
    /APP_DERIVED_PREFIXES = \[([\s\S]*?)\n\](?: as const)?;/,
  )?.[1];
  return [...(block ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
};

/**
 * Every app identifier the generator asks `generateSpecs` for.
 *
 * The identifier is followed by either the closing paren or a comma: a family
 * that declares its own security scheme passes spec options as a second
 * argument, and those are exactly the families most worth checking.
 */
const mergedApps = (source: string): string[] =>
  [
    ...new Set(
      [...source.matchAll(/generateSpecs\(\s*([A-Za-z0-9_]+)\s*[,)]/g)].map(
        (match) => match[1]!,
      ),
    ),
  ].sort();

const APP_ROOT = resolve(dirname(GENERATOR_PATH), "../..");

/** The `tsconfig.json` path aliases an app import can be written through. */
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["@ee/", "ee/"],
  ["~/", "src/"],
];

/** One import specifier as an absolute file, alias or relative. */
const specifierFile = (specifier: string): string => {
  for (const [alias, directory] of ALIASES) {
    if (specifier.startsWith(alias)) {
      return `${resolve(APP_ROOT, directory + specifier.slice(alias.length))}.ts`;
    }
  }

  return `${resolve(dirname(GENERATOR_PATH), specifier)}.ts`;
};

/** Where each of those identifiers is imported from, as an absolute file. */
const importedFiles = (source: string): Map<string, string> => {
  const files = new Map<string, string>();

  for (const match of source.matchAll(
    /import\s*\{\s*app as ([A-Za-z0-9_]+)\s*\}\s*from\s*"([^"]+)"/g,
  )) {
    files.set(match[1]!, specifierFile(match[2]!));
  }

  return files;
};

/**
 * The sources that register routes on one app: the imported file, plus the
 * siblings that extend it. `app.v1.ts` next to `app.ts` registers against the
 * app its neighbour built and declares no basePath of its own, which is the
 * same shape `basePathsFor` in the gate resolves the other way around.
 */
const sourcesRegisteringOn = (file: string): string[] => {
  const stem = basename(file, ".ts");
  const directory = dirname(file);
  const sources = [readFileSync(file, "utf8")];

  for (const entry of readdirSync(directory)) {
    if (!entry.startsWith(`${stem}.`) || !entry.endsWith(".ts")) continue;
    const source = readFileSync(join(directory, entry), "utf8");
    if (apiBasePathsOf(source).length === 0) sources.push(source);
  }

  return sources;
};

/**
 * The document paths one app contributes.
 *
 * Only described routes count. An unannotated handler contributes nothing to
 * the merge no matter which app it sits in, which is exactly why the stripe
 * webhook and the demo bot can share a file with a published route.
 */
const documentedPathsOf = (file: string): string[] => {
  const source = readFileSync(file, "utf8");
  const basePaths = [...apiBasePathsOf(source), ...serviceBasePathsOf(source)];
  const paths = new Set<string>();

  for (const registeringSource of sourcesRegisteringOn(file)) {
    for (const registration of collectRouteRegistrations(registeringSource)) {
      if (!registration.described) continue;
      for (const basePath of basePaths) {
        paths.add(
          honoPathToTemplate(
            joinRoutePath({ basePath, routePath: registration.path }),
          ),
        );
      }
    }
  }

  return [...paths];
};

describe("APP_DERIVED_PREFIXES", () => {
  it("names an app the generator merges for every identifier it asks about", () => {
    // The check below is only as good as this resolution: a renamed import
    // would leave it comparing an empty path list against the prefixes and
    // passing without looking at anything.
    const source = generatorSource();
    const files = importedFiles(source);

    // A renamed or wrapped `generateSpecs(...)` call site would empty this
    // list, and every check below would then pass against nothing.
    expect(mergedApps(source).length).toBeGreaterThan(0);

    // A call form the pattern cannot read is worse than an empty list: it
    // drops one family and leaves the rest passing, which is silent. Every
    // call site has to yield an identifier.
    expect(mergedApps(source)).toHaveLength(
      [...source.matchAll(/generateSpecs\(/g)].length,
    );

    expect(
      mergedApps(source).filter((identifier) => !files.has(identifier)),
    ).toEqual([]);
  });

  /** @scenario "Every app the generator merges is covered by an app-derived prefix" */
  it("owns every path of every app the generator merges", () => {
    const source = generatorSource();
    const prefixes = appDerivedPrefixes(source);
    const files = importedFiles(source);

    const owned = (path: string): boolean =>
      prefixes.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      );

    const unowned = mergedApps(source).flatMap((identifier) => {
      const file = files.get(identifier);
      if (file === undefined) return [];
      return documentedPathsOf(file)
        .filter((path) => !owned(path))
        .map((path) => `${identifier}: ${path}`);
    });

    expect(unowned).toEqual([]);
  });

  it("is matched on whole segments, which is what this check assumes", () => {
    // `owned` above mirrors the generator's own `isAppDerivedPath`. Loosened
    // there to a bare startsWith, the singular experiment prefix would claim
    // the plural surface too, and this check would go on passing while
    // asserting a boundary the merge no longer keeps.
    const source = generatorSource();

    expect(source).toContain("key === prefix");
    expect(source).toContain("key.startsWith(`${prefix}/`)");
  });
});

describe("the UNPUBLISHED list", () => {
  it("gives every entry a reason", () => {
    const unreasoned = UNPUBLISHED.filter(
      (entry) => entry.why.trim().length === 0,
    );

    expect(unreasoned).toEqual([]);
  });

  it("names each operation or prefix once", () => {
    const matches = UNPUBLISHED.map((entry) => entry.match);

    expect(new Set(matches).size).toBe(matches.length);
  });

  describe("when one entry sits inside another's prefix", () => {
    // The probe has to be a real operation key. An entry written in the
    // operation form already is one; a prefix entry needs a method bolted on.
    // Building `GET ${match}` unconditionally was the bug that let
    // `POST /api/admin/{resource}` hide under the `/api/admin` prefix: the
    // probe became `GET POST /api/admin/{resource}`, whose path reads as
    // `POST /api/admin/{resource}` and matches no prefix at all.
    const probe = (match: string) =>
      match.startsWith("/") ? `GET ${match}` : match;

    it("builds a probe key that a prefix entry can actually match", () => {
      expect(probe("/api/admin")).toBe("GET /api/admin");
      expect(probe("POST /api/admin/{resource}")).toBe(
        "POST /api/admin/{resource}",
      );
      expect(
        excludes({
          exclusion: {
            match: "/api/admin",
            category: "internal",
            why: "staff only",
          },
          key: probe("POST /api/admin/{resource}"),
        }),
      ).toBe(true);
    });

    it("reports it, so the redundant entry can be deleted", () => {
      const shadowed = UNPUBLISHED.filter((entry) =>
        UNPUBLISHED.some(
          (other) =>
            other !== entry &&
            other.match.startsWith("/") &&
            entry.match !== other.match &&
            excludes({ exclusion: other, key: probe(entry.match) }),
        ),
      );

      expect(shadowed.map((entry) => entry.match)).toEqual([]);
    });
  });
});

describe("isEntryModule", () => {
  it("is false when node was given no path", () => {
    expect(
      isEntryModule({ invokedPath: undefined, modulePath: "/a/b.ts" }),
    ).toBe(false);
  });

  it("is false for a different file", () => {
    expect(
      isEntryModule({ invokedPath: "/a/other.ts", modulePath: "/a/b.ts" }),
    ).toBe(false);
  });

  it("is true for the same file", () => {
    expect(
      isEntryModule({ invokedPath: "/a/b.ts", modulePath: "/a/b.ts" }),
    ).toBe(true);
  });
});

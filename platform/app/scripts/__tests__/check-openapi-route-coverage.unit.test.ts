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

import { describe, expect, it } from "vitest";

import {
  auditCoverage,
  documentedOperations,
  type Exclusion,
  excludes,
  isEntryModule,
  type RegisteredRoute,
  UNPUBLISHED,
} from "../check-openapi-route-coverage";

const route = (key: string, described = false): RegisteredRoute => ({
  key,
  file: "src/server/routes/example.ts",
  described,
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
      const result = audit({ routes: [route("POST /api/experiment/init")] });

      expect(result.unexplained.map((r) => r.key)).toEqual([
        "POST /api/experiment/init",
      ]);
    });

    /** @scenario "An internal route is excluded by a written reason" */
    it("stays silent once an exclusion explains it", () => {
      const result = audit({
        routes: [route("POST /api/experiments/execute")],
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
        routes: [route("GET /api/experiments")],
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
        routes: [route("GET /api/experiments")],
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
        routes: [route("GET /api/experiments")],
        documented: ["GET /api/experiments"],
        exclusions: [entry],
      });

      expect(result.stale).toEqual([entry]);
    });
  });

  describe("when the same route is registered from two basePaths", () => {
    it("counts each spelling once", () => {
      const result = audit({
        routes: [route("GET /api/experiments"), route("GET /api/experiments")],
        documented: ["GET /api/experiments"],
      });

      expect(result.registered).toBe(1);
    });
  });

  /** @scenario "A route annotated but whose app is unwired is still caught" */
  it("catches an annotated route whose app the generator never imports", () => {
    const result = audit({
      routes: [route("GET /api/projects/{id}/api-key", true)],
    });

    expect(result.unexplained.map((r) => r.key)).toEqual([
      "GET /api/projects/{id}/api-key",
    ]);
    // The flag is what lets the report say which of the three publishing steps
    // was skipped, rather than leaving the reader to guess.
    expect(result.unexplained[0]?.described).toBe(true);
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

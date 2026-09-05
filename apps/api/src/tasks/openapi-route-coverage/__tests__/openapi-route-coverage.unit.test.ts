/**
 * The route-coverage gate, driven through the real mount.
 */

// Both directions are pinned: an unexplained gap has to fail, and so does an
// exclusion that explains nothing. Where the monolith's gate parsed source,
// this one reads the composed process, so the scenarios about the old reader's
// blind spots are re-bound against the mount.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createService, type MountedRoute } from "@langwatch/api/rest";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { composeOpenApiDocumentSurface } from "../../openapi-document/openapi-document.surface";
import {
  auditCoverage,
  coverageFailed,
  excludes,
  renderCoverageReport,
  type CoverageRoute,
} from "../openapi-route-coverage.auditor";
import { type Exclusion, UNPUBLISHED } from "../openapi-route-coverage.exclusions";
import {
  documentAddressOf,
  readCoverageSurface,
  type CoverageSurface,
} from "../openapi-route-coverage.surface";

const route = ({
  key,
  pathDescribed = false,
  withdrawn,
  namespaceGuard,
}: {
  key: string;
  pathDescribed?: boolean;
  withdrawn?: boolean;
  namespaceGuard?: boolean;
}): CoverageRoute => ({
  key,
  family: "example",
  pathDescribed,
  ...(withdrawn === undefined ? {} : { withdrawn }),
  ...(namespaceGuard === undefined ? {} : { namespaceGuard }),
});

const audit = ({
  routes,
  documented = [],
  exclusions = [],
}: {
  routes: CoverageRoute[];
  documented?: string[];
  exclusions?: Exclusion[];
}) => auditCoverage({ routes, documented: new Set(documented), exclusions });

/**
 * One fixture family, built through the real framework and mounted nowhere.
 * The mounts are captured off `onRouteMounted`, not the process-wide registry,
 * so a fixture cannot leak into the audit of the real surface below.
 */
function mountsOf(build: (mounted: MountedRoute[]) => void): string[] {
  const mounted: MountedRoute[] = [];
  build(mounted);
  return mounted.map(documentAddressOf).sort();
}

describe("excludes", () => {
  describe("when the entry names one operation", () => {
    it("matches only that method and path", () => {
      const entry: Exclusion = {
        match: "POST /api/v1/experiments/execute",
        category: "internal",
        why: "session authenticated",
      };

      expect(excludes({ exclusion: entry, key: "POST /api/v1/experiments/execute" })).toBe(true);
      expect(excludes({ exclusion: entry, key: "GET /api/v1/experiments/execute" })).toBe(false);
    });
  });

  describe("when the entry names a prefix", () => {
    it("matches the prefix itself and everything beneath it", () => {
      const entry: Exclusion = {
        match: "/api/v1/internal",
        category: "internal",
        why: "the control plane's own calls",
      };

      expect(excludes({ exclusion: entry, key: "GET /api/v1/internal" })).toBe(true);
      expect(excludes({ exclusion: entry, key: "POST /api/v1/internal/langy/relay/frames" })).toBe(
        true,
      );
    });

    it("does not match a sibling path that merely shares a word start", () => {
      const entry: Exclusion = {
        match: "/api/v1/github",
        category: "internal",
        why: "example",
      };

      expect(excludes({ exclusion: entry, key: "GET /api/v1/github-langy/setup" })).toBe(false);
    });
  });
});

describe("auditCoverage", () => {
  describe("when a mounted route is absent from the document", () => {
    /** @scenario "A public route missing from the document fails the check" */
    it("reports it as unexplained and fails the run", () => {
      const result = audit({ routes: [route({ key: "POST /api/v1/experiment/init" })] });

      expect(result.unexplained.map((r) => r.key)).toEqual(["POST /api/v1/experiment/init"]);
      expect(coverageFailed(result)).toBe(true);
    });

    /** @scenario "An internal route is excluded by a written reason" */
    it("stays silent once an exclusion explains it", () => {
      const result = audit({
        routes: [route({ key: "POST /api/v1/experiments/execute" })],
        exclusions: [
          {
            match: "POST /api/v1/experiments/execute",
            category: "internal",
            why: "session authenticated",
          },
        ],
      });

      expect(result.unexplained).toEqual([]);
      expect(result.stale).toEqual([]);
      expect(coverageFailed(result)).toBe(false);
    });
  });

  describe("when a route is in the document", () => {
    it("neither reports it nor counts it as unexplained", () => {
      const result = audit({
        routes: [route({ key: "GET /api/v1/experiments" })],
        documented: ["GET /api/v1/experiments"],
      });

      expect(result.unexplained).toEqual([]);
      expect(result.documented).toBe(1);
      expect(result.mounted).toBe(1);
    });
  });

  describe("when an exclusion explains nothing", () => {
    /** @scenario "An exclusion that no longer suppresses anything fails the check" */
    it("reports the entry as stale and fails the run", () => {
      const stale: Exclusion = {
        match: "POST /api/v1/gone",
        category: "gap",
        why: "deleted last quarter",
      };

      const result = audit({
        routes: [route({ key: "GET /api/v1/experiments" })],
        documented: ["GET /api/v1/experiments"],
        exclusions: [stale],
      });

      expect(result.stale).toEqual([stale]);
      expect(coverageFailed(result)).toBe(true);
    });

    it("counts an entry as used only when the route is actually missing", () => {
      const entry: Exclusion = {
        match: "GET /api/v1/experiments",
        category: "gap",
        why: "not published yet",
      };

      const result = audit({
        routes: [route({ key: "GET /api/v1/experiments" })],
        documented: ["GET /api/v1/experiments"],
        exclusions: [entry],
      });

      expect(result.stale).toEqual([entry]);
    });
  });

  describe("when the document describes an operation no route answers", () => {
    it("reports it as orphaned and fails the run", () => {
      const result = audit({
        routes: [route({ key: "GET /api/v1/experiments" })],
        documented: ["GET /api/v1/experiments", "GET /api/v1/retired"],
      });

      expect(result.orphaned).toEqual(["GET /api/v1/retired"]);
      expect(coverageFailed(result)).toBe(true);
    });

    it("treats an ALL route as answering every method on its path", () => {
      const result = audit({
        routes: [route({ key: "ALL /api/v1/unsubscribe" })],
        documented: ["POST /api/v1/unsubscribe"],
      });

      expect(result.orphaned).toEqual([]);
    });
  });

  /** @scenario "A route annotated but whose app is unwired is still caught" */
  it("catches a route on a described path whose own operation never reached the document", () => {
    // Annotation alone publishes nothing: the operation still has to reach the
    // document. The flag is what lets the report say which of the publishing
    // steps was skipped rather than leaving the reader to guess.
    const result = audit({
      routes: [route({ key: "PATCH /api/v1/projects/{id}", pathDescribed: true })],
    });

    expect(result.unexplained.map((r) => r.key)).toEqual(["PATCH /api/v1/projects/{id}"]);
    expect(result.unexplained[0]?.pathDescribed).toBe(true);
    expect(renderCoverageReport({ result, exclusions: [] })).toContain("the path is described");
  });

  describe("when a mounted route is a withdrawn tombstone", () => {
    /** @scenario "A withdrawn endpoint is accounted for without an exclusion entry" */
    it("accounts for it without asking for an exclusion entry", () => {
      // A withdrawn endpoint answers 410 and has no handler behind it, so
      // there is nothing for the generator to describe and no way to publish
      // it. Demanding a written reason would ask an author to explain the one
      // thing the route's own shape already says.
      const result = audit({
        routes: [route({ key: "GET /api/v1/roles/{id}/legacy", withdrawn: true })],
      });

      expect(result.unexplained).toEqual([]);
      expect(result.undocumentable.map((r) => r.key)).toEqual(["GET /api/v1/roles/{id}/legacy"]);
      expect(result.stale).toEqual([]);
      expect(coverageFailed(result)).toBe(false);
    });

    it("keeps it in the bucket and reports the exclusion written for it as stale", () => {
      // The tombstone is accounted for by its own shape, so an entry whose
      // only match is one excuses nothing. Counting it as used would let a
      // redundant entry outlive the route it was written for, which is the
      // one thing the ratchet exists to stop.
      const entry: Exclusion = { match: "/api/v1/roles", category: "internal", why: "example" };

      const result = audit({
        routes: [route({ key: "GET /api/v1/roles/{id}/legacy", withdrawn: true })],
        exclusions: [entry],
      });

      expect(result.stale).toEqual([entry]);
    });

    it("still lets a live route under the same prefix keep the entry earning", () => {
      const entry: Exclusion = { match: "/api/v1/roles", category: "internal", why: "example" };

      const result = audit({
        routes: [
          route({ key: "GET /api/v1/roles/{id}/legacy", withdrawn: true }),
          route({ key: "GET /api/v1/roles/{id}/internal" }),
        ],
        exclusions: [entry],
      });

      expect(result.unexplained).toEqual([]);
      expect(result.stale).toEqual([]);
    });
  });

  describe("when a route is a version-namespace guard", () => {
    it("accounts for it by shape, like a tombstone", () => {
      const result = audit({
        routes: [route({ key: "ALL /api/v1/roles/{apiVersion}", namespaceGuard: true })],
      });

      expect(result.unexplained).toEqual([]);
      expect(result.undocumentable.map((r) => r.key)).toEqual(["ALL /api/v1/roles/{apiVersion}"]);
    });
  });
});

describe("documentAddressOf", () => {
  /** @scenario "A parameter's routing constraint does not reach the template" */
  it("drops a Hono routing constraint so the parameter templates on its own", () => {
    // `:id{.+?}` in the source. Carried through, this reads as `{id}{.+?}` and
    // matches nothing in the document, so every route spelled that way looks
    // undocumented forever.
    expect(documentAddressOf({ method: "GET", path: "/api/prompts/:id{.+?}/versions" })).toBe(
      "GET /api/prompts/{id}/versions",
    );
  });

  it("counts a two-address family at the address the document publishes", () => {
    expect(
      documentAddressOf({
        method: "GET",
        path: "/api/prompts",
        canonicalPath: "/api/v1/prompts",
      }),
    ).toBe("GET /api/v1/prompts");
  });
});

describe("the route table read off a built service", () => {
  const service = (mounted: MountedRoute[]) =>
    createService({ name: "roles", onRouteMounted: (r) => mounted.push(r) }).withoutPermission(
      "route-table fixture",
    );

  /** @scenario "A service declaring only its name is counted under its derived prefix" */
  it("counts its routes under the prefix the framework derives from the name", () => {
    // The service says `name: "roles"` and the framework turns that into
    // `/api/roles`, published at `/api/v1/roles`. Nothing anywhere spells the
    // prefix out, so a reader that needed one written down would find none.
    const mounts = mountsOf((mounted) => {
      service(mounted)
        .registerRoute(
          "get",
          "/",
          "2026-08-07",
          async () => [],
          (b) => b.withOutput(z.array(z.string())),
        )
        .registerRoute(
          "get",
          "/:id",
          "2026-08-07",
          async () => "",
          (b) => b.withParams(z.object({ id: z.string() })).withOutput(z.string()),
        )
        .build();
    });

    expect(mounts).toContain("GET /api/v1/roles");
    expect(mounts).toContain("GET /api/v1/roles/{id}");
  });

  /** @scenario "A versioned registration is counted at its dated and latest mounts" */
  it("counts one registration at each dated mount and at the latest mount", () => {
    // Main's reader collapsed every version of a path onto one bare key, so a
    // family serving two generations reported as a single route. The mount
    // report is the truth instead: each dated namespace and `latest` is its
    // own address, and the bare alias is not the only place the endpoint is
    // counted.
    const mounts = mountsOf((mounted) => {
      service(mounted)
        .registerRoute(
          "get",
          "/",
          "2026-01-01",
          async () => [],
          (b) => b.withOutput(z.array(z.string())),
        )
        .registerRoute(
          "get",
          "/",
          "2026-08-07",
          async () => [],
          (b) => b.withOutput(z.array(z.string())),
        )
        .build();
    });

    expect(mounts).toContain("GET /api/v1/roles/2026-01-01/");
    expect(mounts).toContain("GET /api/v1/roles/2026-08-07/");
    expect(mounts).toContain("GET /api/v1/roles/latest/");
  });

  /** @scenario "An SSE endpoint is counted as a GET route" */
  it("counts a server-sent-event endpoint as a GET route", () => {
    const mounts = mountsOf((mounted) => {
      service(mounted)
        .registerSse("events.watch", "2026-08-07", async () => {})
        .build();
    });

    expect(mounts).toContain("GET /api/v1/roles/latest/events.watch");
    expect(mounts.filter((mount) => mount.includes("events.watch"))).not.toEqual([]);
    for (const mount of mounts.filter((m) => m.includes("events.watch"))) {
      expect(mount.startsWith("GET ")).toBe(true);
    }
  });

  it("carries a withdrawal through to the mount report", () => {
    const mounted: MountedRoute[] = [];
    service(mounted)
      .registerRoute(
        "get",
        "/:id/legacy",
        "2026-01-01",
        async () => "",
        (b) => b.withParams(z.object({ id: z.string() })).withOutput(z.string()),
      )
      .withdrawRoute("get", "/:id/legacy", "2026-08-07")
      .build();

    expect(mounted.filter((route) => route.withdrawn).map(documentAddressOf)).not.toEqual([]);
  });

  /** @scenario "A test helper named createService declares no service" */
  it("derives no base path from a local helper that merely shares the name", () => {
    // A file of this repo's own can hold a function called `createService`
    // that builds anything at all. Reading the source, main's gate had to tell
    // the two apart by shape; reading the mount, there is nothing to tell
    // apart — a helper that mounts nothing reports nothing.
    const createService = ({ name }: { name: string }) => ({ region: name });

    const mounts = mountsOf(() => {
      const helper = createService({ name: "eu" });
      expect(helper.region).toBe("eu");
    });

    expect(mounts).toEqual([]);
  });
});

describe("the composed REST surface", () => {
  let surface: CoverageSurface;

  beforeAll(async () => {
    const directory = await mkdtemp(join(tmpdir(), "openapi-route-coverage-"));
    surface = await readCoverageSurface({
      scratchPath: join(directory, "document.json"),
    });
  }, 120_000);

  /** @scenario "Routes registered in a file with no basePath are still counted" */
  it("counts a family's whole surface, whichever file registered each route", () => {
    // The prompts family spreads its registrations over several files, one of
    // which registers against an app its sibling constructed. Reading source,
    // that file declared no basePath and its routes went uncounted — the whole
    // prompts v1 surface. Reading the mount, every route arrives the same way.
    const keys = new Set(surface.routes.map((route) => route.key));

    expect(keys).toContain("GET /api/v1/prompts");
    expect(keys).toContain("GET /api/v1/prompts/{id}");
    expect(keys).toContain("GET /api/v1/prompts/{id}/versions");
  });

  /** @scenario "Every app the generator merges is covered by an app-derived prefix" */
  it("sees every route the description is generated from, and names what it left out", () => {
    // Main's generator merged a hand-listed set of apps, and an app whose
    // prefix nobody declared contributed operations nothing checked. Here the
    // routes and the operations come from ONE composed application, so the
    // equivalent hole would be a documented operation with no route behind it.
    const result = auditCoverage({
      routes: surface.routes,
      documented: surface.documented,
      exclusions: UNPUBLISHED,
    });

    expect(result.orphaned).toEqual([]);

    // The families the surface deliberately cannot describe are the other half
    // of the claim: each one is named with a reason rather than silently absent.
    for (const absence of composeOpenApiDocumentSurface().absences) {
      expect(absence.because.trim().length).toBeGreaterThan(0);
    }
  });

  it("is green: every mounted route is documented or accounted for", () => {
    const result = auditCoverage({
      routes: surface.routes,
      documented: surface.documented,
      exclusions: UNPUBLISHED,
    });

    expect(result.unexplained.map((route) => route.key)).toEqual([]);
    expect(result.stale.map((entry) => entry.match)).toEqual([]);
    expect(coverageFailed(result)).toBe(false);
  });
});

describe("the UNPUBLISHED list", () => {
  it("gives every entry a reason", () => {
    expect(UNPUBLISHED.filter((entry) => entry.why.trim().length === 0)).toEqual([]);
  });

  it("names each operation or prefix once", () => {
    const matches = UNPUBLISHED.map((entry) => entry.match);

    expect(new Set(matches).size).toBe(matches.length);
  });

  describe("when one entry sits inside another's prefix", () => {
    // The probe has to be a real operation key. An entry written in the
    // operation form already is one; a prefix entry needs a method bolted on.
    const probe = (match: string) => (match.startsWith("/") ? `GET ${match}` : match);

    it("builds a probe key that a prefix entry can actually match", () => {
      expect(probe("/api/v1/internal")).toBe("GET /api/v1/internal");
      expect(probe("POST /api/v1/internal/langy/relay/frames")).toBe(
        "POST /api/v1/internal/langy/relay/frames",
      );
      expect(
        excludes({
          exclusion: { match: "/api/v1/internal", category: "internal", why: "internal secret" },
          key: probe("POST /api/v1/internal/langy/relay/frames"),
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

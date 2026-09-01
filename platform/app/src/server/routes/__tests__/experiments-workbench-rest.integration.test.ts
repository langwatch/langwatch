/**
 * @vitest-environment node
 *
 * The workbench half of the experiments REST surface, against real Postgres.
 *
 * These endpoints are what an agent or a CI job uses to build an experiment
 * without a browser: create one, read its setup, save a new one, list what was
 * saved and bring an old one back. The round trip is exercised end to end
 * because every step hands the next one something the previous step produced —
 * the slug, then the version — and a mocked service would let those drift.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app as publicApp } from "~/app/api/experiments/[[...route]]/app";
import type { PersistedEvaluationsV3State } from "~/experiments-v3/types/persistence";
import type { Project } from "~/generated/prisma/client";
import { allRegisteredRoutes } from "~/server/api/security";
import { policyPermissions } from "~/server/api/security/access-policy";
import { prisma } from "~/server/db";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { getTestProject } from "~/utils/testUtils";
import { app as workbenchApp } from "../experiments-v3";

wireDefaultTestApp();

const stateNamed = (name: string): PersistedEvaluationsV3State =>
  ({
    name,
    datasets: [
      {
        id: "dataset-1",
        name: "Inline",
        type: "inline",
        columns: [{ id: "input", name: "input", type: "string" }],
      },
    ],
    activeDatasetId: "dataset-1",
    evaluators: [],
    targets: [],
  }) as PersistedEvaluationsV3State;

describe("the experiments workbench REST surface", () => {
  let project: Project;
  const createdIds: string[] = [];

  /**
   * The namespace as the API router composes it: the workbench and run
   * endpoints from `experiments-v3`, and the list / create endpoints from the
   * public experiments app, in the order `createApiRouter` mounts them.
   */
  const namespace = () =>
    new Hono().route("/", workbenchApp).route("/", publicApp);

  const request = async ({
    path,
    method = "GET",
    body,
    token,
  }: {
    path: string;
    method?: string;
    body?: unknown;
    token?: string;
  }) => {
    return namespace().request(`/api/experiments${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": token ?? project.apiKey,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  /**
   * Fixture, not a test: a create that fails here is a broken arrangement, so
   * it throws with the status AND the body rather than asserting. That reads
   * better than "expected 500 to be 200" in a test whose subject is something
   * else, and every test that cares about the create asserts on the result it
   * gets back.
   */
  const createExperiment = async (body: unknown = {}) => {
    const res = await request({ path: "", method: "POST", body });
    const text = await res.text();
    if (res.status !== 200) {
      throw new Error(
        `Arranging an experiment answered ${res.status}: ${text}`,
      );
    }
    const created = JSON.parse(text) as {
      id: string;
      slug: string;
      version: number;
    };
    createdIds.push(created.id);
    return created;
  };

  beforeAll(async () => {
    project = await getTestProject("experiments-workbench-rest");
  });

  afterAll(async () => {
    // Vitest runs teardown even when the arrangement above threw, and reading
    // `project.id` then reports a TypeError from here instead of the real
    // failure. Nothing was created either, so there is nothing to clean up.
    if (!project) return;
    await prisma.experimentVersion.deleteMany({
      where: { experimentId: { in: createdIds }, projectId: project.id },
    });
    await prisma.experiment.deleteMany({
      where: { id: { in: createdIds }, projectId: project.id },
    });
  });

  describe("given a project API key", () => {
    describe("when the caller creates an experiment with no setup", () => {
      /** @scenario "Creating an experiment over REST gives a workbench you can open" */
      it("creates a blank workbench at version 1", async () => {
        const created = await createExperiment({ name: `Blank ${nanoid(6)}` });

        expect(created.version).toBe(1);
        expect(created.slug).toBeTruthy();

        const read = await request({
          path: `/${created.slug}/workbench-state`,
        });
        const workbench = (await read.json()) as {
          id: string;
          slug: string;
          version: number;
          state: { datasets: unknown[]; targets: unknown[] };
        };

        expect(read.status).toBe(200);
        expect(workbench.id).toBe(created.id);
        expect(workbench.version).toBe(1);
        expect(workbench.state.datasets).toHaveLength(1);
        expect(workbench.state.targets).toHaveLength(0);
      });
    });

    describe("when the caller walks the whole round trip", () => {
      /** @scenario "An agent edits an experiment through the REST surface" */
      it("creates, reads, saves, lists versions and restores", async () => {
        const created = await createExperiment({
          state: stateNamed("First setup"),
        });

        const saved = await request({
          path: `/${created.slug}/workbench-state`,
          method: "PUT",
          body: {
            state: stateNamed("Second setup"),
            expectedVersion: created.version,
            commitMessage: "Renamed the setup",
          },
        });
        expect(saved.status).toBe(200);
        expect(await saved.json()).toEqual({ version: 2 });

        const listed = await request({ path: `/${created.slug}/versions` });
        const history = (await listed.json()) as {
          versions: {
            version: number;
            commitMessage: string | null;
            authorLabel: string;
            createdAt: string;
          }[];
          nextCursor: number | null;
        };

        expect(listed.status).toBe(200);
        expect(history.versions.map((entry) => entry.version)).toEqual([2, 1]);
        expect(history.versions[0]?.commitMessage).toBe("Renamed the setup");
        expect(history.versions[0]?.authorLabel).toBe("api");
        expect(history.nextCursor).toBeNull();

        const restored = await request({
          path: `/${created.slug}/versions/1/restore`,
          method: "POST",
        });
        expect(restored.status).toBe(200);
        expect(await restored.json()).toEqual({ version: 3 });

        const afterRestore = await request({
          path: `/${created.slug}/workbench-state`,
        });
        const workbench = (await afterRestore.json()) as {
          version: number;
          state: { name: string };
        };
        expect(workbench.version).toBe(3);
        expect(workbench.state.name).toBe("First setup");
      });
    });

    describe("when the caller asks for the version field only", () => {
      /** @scenario "A poller checks for changes without pulling the setup" */
      it("answers with the version and leaves the setup out", async () => {
        const created = await createExperiment({
          state: stateNamed("Probe me"),
        });

        const res = await request({
          path: `/${created.slug}/workbench-state?fields=version`,
        });
        const body = (await res.json()) as Record<string, unknown>;

        expect(res.status).toBe(200);
        expect(body.version).toBe(1);
        expect(body.slug).toBe(created.slug);
        expect(body.updatedAt).toEqual(expect.any(String));
        expect(body).not.toHaveProperty("state");
      });
    });

    describe("when a save names a version someone already wrote over", () => {
      /** @scenario "A stale save is refused with the version to read again" */
      it("answers 409 carrying the stale code and the current version", async () => {
        const created = await createExperiment({
          state: stateNamed("Racing setup"),
        });

        await request({
          path: `/${created.slug}/workbench-state`,
          method: "PUT",
          body: {
            state: stateNamed("Winner"),
            expectedVersion: created.version,
          },
        });

        const stale = await request({
          path: `/${created.slug}/workbench-state`,
          method: "PUT",
          body: {
            state: stateNamed("Loser"),
            expectedVersion: created.version,
          },
        });
        const body = (await stale.json()) as {
          error: string;
          currentVersion?: number;
        };

        expect(stale.status).toBe(409);
        expect(body.error).toBe("experiment_stale_workbench_state");
        expect(body.currentVersion).toBe(2);

        const read = await request({
          path: `/${created.slug}/workbench-state`,
        });
        const workbench = (await read.json()) as { state: { name: string } };
        expect(workbench.state.name).toBe("Winner");
      });
    });

    describe("when a save carries a setup that does not match the schema", () => {
      /** @scenario "A setup that cannot be read is refused with its code" */
      it("answers 400 with the invalid-state code", async () => {
        const created = await createExperiment({
          state: stateNamed("Valid to start with"),
        });

        const res = await request({
          path: `/${created.slug}/workbench-state`,
          method: "PUT",
          body: { state: { name: "no datasets here" } },
        });
        const body = (await res.json()) as { error: string };

        expect(res.status).toBe(400);
        expect(body.error).toBe("experiment_invalid_workbench_state");
      });
    });

    describe("when the slug belongs to no experiment in this project", () => {
      /** @scenario "An unknown experiment reads as not found" */
      it("answers 404 with the experiment code", async () => {
        const res = await request({
          path: `/no-such-experiment-${nanoid(6)}/workbench-state`,
        });
        const body = (await res.json()) as { error: string };

        expect(res.status).toBe(404);
        expect(body.error).toBe("experiment_not_found");
      });
    });

    describe("when a restore names a version the experiment never had", () => {
      /** @scenario "A restore of a version that does not exist reads as not found" */
      it("answers 404 with the version code", async () => {
        const created = await createExperiment({
          state: stateNamed("Only one version"),
        });

        const res = await request({
          path: `/${created.slug}/versions/99/restore`,
          method: "POST",
        });
        const body = (await res.json()) as { error: string };

        expect(res.status).toBe(404);
        expect(body.error).toBe("experiment_version_not_found");
      });
    });

    describe("when a restore names a segment that is not a version number", () => {
      /** @scenario "A restore of a version that does not exist reads as not found" */
      it("answers 404 with a version a caller can parse", async () => {
        const created = await createExperiment({
          state: stateNamed("Only one version"),
        });

        const res = await request({
          path: `/${created.slug}/versions/abc/restore`,
          method: "POST",
        });
        const body = (await res.json()) as {
          error: string;
          experimentId: string;
          version: unknown;
        };

        expect(res.status).toBe(404);
        expect(body.error).toBe("experiment_version_not_found");
        expect(body.experimentId).toBe(created.id);
        // `Number("abc")` is `NaN`, and JSON writes `NaN` as `null`. A caller
        // that reads `version` as a number has to be able to parse the 404 it
        // just got, so the envelope carries a real number.
        expect(body.version).toBe(0);
      });
    });

    describe("when the request carries no credentials", () => {
      /** @scenario "The workbench endpoints refuse an unauthenticated caller" */
      it("answers 401", async () => {
        const res = await namespace().request("/api/experiments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        expect(res.status).toBe(401);
      });
    });
  });

  /**
   * The registry is filled at module-load time, so the `workbenchApp` and
   * `publicApp` imports at the top of this file are what put these routes in it.
   */
  describe("given the route registry", () => {
    /** @scenario "Each workbench endpoint declares the grain it needs" */
    it.each([
      ["POST", "/api/experiments", "experiments:create"],
      ["GET", "/api/experiments/:slug/workbench-state", "experiments:view"],
      ["PUT", "/api/experiments/:slug/workbench-state", "experiments:update"],
      ["GET", "/api/experiments/:slug/versions", "experiments:view"],
      [
        "POST",
        "/api/experiments/:slug/versions/:version/restore",
        "experiments:update",
      ],
    ])("declares %s %s as %s", (method, path, permission) => {
      const route = allRegisteredRoutes().find(
        (registered) =>
          registered.method === method &&
          registered.path.replace(/\/$/, "") === path,
      );

      expect(route).toBeDefined();
      // The WHOLE set the route demands, not its first entry: a route that also
      // asked for `admin:everything` would still read as least-privilege if
      // only one entry were checked, and pinning the exact grain is what this
      // suite is for. `policyPermissions` covers both declaration kinds that
      // share this namespace: the workbench routes authenticate in-handler and
      // declare `permissions`, the create route goes through the builder chain
      // and declares one `permission`.
      expect(policyPermissions(route!.policy)).toEqual([permission]);
    });
  });
});

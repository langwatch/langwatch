/**
 * @vitest-environment node
 *
 * `GET /api/experiments/:slug` (#7580). The namespace already answered
 * `POST /:slug/run`, `GET /:slug/versions` and `GET /:slug/workbench-state`
 * for the same slug, so the one call a reader makes first, list and then fetch
 * one, was the only one missing. It fell through to the framework's own 404,
 * which cannot be told apart from "no such experiment", and callers concluded
 * the experiment was gone while the list was still returning it.
 *
 * Every assertion below carries the response body in its failure message: a
 * bare "expected 500 to be 200" from an API test says nothing about which of
 * the three layers refused.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { ExperimentType } from "~/generated/prisma/client";
import { globalForApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { app } from "../[[...route]]/app";

/**
 * Run counts come from ClickHouse, and the default test App has no client, so
 * the aggregate call throws and the whole read answers 500. That is the same
 * behaviour the list route has, deliberately: the run store being down is an
 * infrastructure error worth surfacing rather than a zero worth inventing.
 *
 * So the store is stubbed at its own boundary rather than removed. The stub
 * answers no rows, which is the truth for a freshly created experiment, and
 * leaves the route to do the part this file is about: resolve the experiment
 * and shape it the way the list does.
 */
const clickHouseStub = {
  enabled: true,
  resolveClient: async () =>
    ({
      // The aggregate query asks for JSONEachRow, so `json()` answers an array
      // of rows rather than a `{ data }` envelope. An empty array is the true
      // answer for an experiment that has never run.
      query: async () => ({ json: async () => [] }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolveOrganizationClient: async () => ({}) as any,
  allInstances: async () => [],
};

beforeAll(() => {
  globalForApp.__langwatch_app = createTestApp({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clickhouse: clickHouseStub as any,
  });
});

afterAll(() => {
  globalForApp.__langwatch_app = null;
});

describe("given a project with one saved experiment", () => {
  const ns = nanoid(8);

  // Optional, and read back that way in teardown: a `beforeAll` that fails
  // part way leaves the rows after it unassigned, and a teardown that reads
  // `project.id` then throws over the setup error that actually explains the
  // run.
  let organization: Organization | undefined;
  let team: Team | undefined;
  let project: Project | undefined;
  let experimentId: string | undefined;
  const slug = `read-one-${ns}`;

  /** Returns the status and the parsed body, plus the raw text for messages. */
  const read = async ({
    slugOrId,
    apiKey,
  }: {
    slugOrId: string;
    apiKey?: string;
  }) => {
    const response = await app.request(`/api/experiments/${slugOrId}`, {
      method: "GET",
      headers: { "X-Auth-Token": apiKey ?? project?.apiKey ?? "" },
    });
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) };
  };

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: `Read One Org ${ns}`, slug: `--test-read-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: `Team ${ns}`,
        slug: `--team-read-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `--proj-read-${ns}` }),
        teamId: team.id,
        personalFeatures: {},
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        projectId: project.id,
        name: "Support email classifier",
        slug,
        type: ExperimentType.EVALUATIONS_V3,
        workbenchState: { name: "Support email classifier" },
      },
    });
    experimentId = experiment.id;
  });

  afterAll(async () => {
    if (!organization) return;
    await cleanupTestRows(prisma, [
      ...(project
        ? ([
            ["experiment", { projectId: project.id }],
            ["project", { id: project.id }],
          ] as const)
        : []),
      ...(team ? ([["team", { id: team.id }]] as const) : []),
      ["organization", { id: organization.id }],
    ]);
  });

  describe("when reading it by the slug the list returns", () => {
    /** @scenario "Reading one experiment answers with the same shape the list uses" */
    it("answers with that experiment, in the list's own shape", async () => {
      const { status, text, body } = await read({ slugOrId: slug });

      expect(status, text).toBe(200);
      expect(body.slug).toBe(slug);
      expect(body.id).toBe(experimentId);
      expect(body.name).toBe("Support email classifier");
      // A caller holding one shape for both calls is the point, so every key
      // the list puts on a row has to be here, run aggregates included.
      expect(body).toHaveProperty("type");
      expect(body).toHaveProperty("createdAt");
      expect(body).toHaveProperty("updatedAt");
      expect(body).toHaveProperty("runsCount");
      expect(body).toHaveProperty("lastRunAt");
    });
  });

  describe("when reading it by its id instead", () => {
    /** @scenario "Either identifier the list returns can be read back" */
    it("accepts the id, because the same list row carries it", async () => {
      const { status, text, body } = await read({ slugOrId: experimentId! });

      expect(status, text).toBe(200);
      expect(body.id).toBe(experimentId);
      expect(body.slug).toBe(slug);
    });
  });

  describe("when the slug belongs to no experiment", () => {
    // The whole point of the route: a caller has to be able to tell "there is
    // no such experiment" from "there is no such route". A named code does
    // that; the framework's bare `{"error":"Not Found"}` did not.
    /** @scenario "A slug that names no experiment is refused by name" */
    it("refuses with the experiment_not_found code", async () => {
      const { status, text, body } = await read({ slugOrId: `no-such-${ns}` });

      expect(status, text).toBe(404);
      expect(body.error).toBe("experiment_not_found");
    });
  });

  describe("when the experiment belongs to another project", () => {
    /** @scenario "An experiment in another project is not readable" */
    it("refuses rather than reading across the tenant boundary", async () => {
      const otherProject = await prisma.project.create({
        data: {
          ...projectFactory.build({ slug: `--proj-read-other-${ns}` }),
          teamId: team!.id,
          personalFeatures: {},
        },
      });

      // In a finally, so a failed assertion above still takes the row back out
      // and leaves the shared test database as it found it.
      try {
        const { status, text } = await read({
          slugOrId: slug,
          apiKey: otherProject.apiKey,
        });

        expect(status, text).toBe(404);
      } finally {
        await cleanupTestRows(prisma, [["project", { id: otherProject.id }]]);
      }
    });
  });
});

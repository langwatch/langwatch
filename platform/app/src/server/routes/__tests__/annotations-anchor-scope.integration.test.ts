/**
 * @vitest-environment node
 *
 * What the annotations REST endpoints return once a comment can be left on one
 * part of a trace: every comment by default, each carrying its anchor, with the
 * trace-only read available to a caller that asks for it.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type { Organization, Project, Team } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { app } from "../annotations";

describe("Annotations REST API", () => {
  const traceId = `test-trace-annotations-rest-${nanoid()}`;
  let organization: Organization;
  let team: Team;
  let project: Project;

  const get = (path: string) =>
    app.request(path, {
      method: "GET",
      headers: { "X-Auth-Token": project.apiKey },
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `test-org-${nanoid()}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: team.id,
        personalFeatures: {},
      },
    });

    await prisma.annotation.create({
      data: {
        id: nanoid(),
        projectId: project.id,
        traceId,
        comment: "the whole trace is off",
      },
    });
    for (const spanId of ["span-1", "span-2", "span-3"]) {
      await prisma.annotation.create({
        data: {
          id: nanoid(),
          projectId: project.id,
          traceId,
          comment: `about ${spanId}`,
          anchorKind: "span",
          anchorId: spanId,
        },
      });
    }
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [["annotation", { projectId: project.id }]]);
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  describe("given a trace with one comment about it and three about its spans", () => {
    /** @scenario "The annotations API returns every annotation by default" */
    it("returns all four comments, and the trace-level one when asked", async () => {
      const byDefault = await get(`/api/annotations/trace/${traceId}`);
      expect(byDefault.status).toBe(200);
      const { data: all } = (await byDefault.json()) as {
        data: { comment: string; anchorKind: string | null }[];
      };
      expect(all).toHaveLength(4);
      expect(all.filter((row) => row.anchorKind === "span")).toHaveLength(3);

      const traceOnly = await get(`/api/annotations/trace/${traceId}?anchor=trace`);
      expect(traceOnly.status).toBe(200);
      const { data: traceLevel } = (await traceOnly.json()) as {
        data: { comment: string }[];
      };
      expect(traceLevel.map((row) => row.comment)).toEqual(["the whole trace is off"]);
    });

    it("lists every comment across the project", async () => {
      const response = await get("/api/annotations");
      expect(response.status).toBe(200);
      const { data } = (await response.json()) as { data: unknown[] };
      expect(data).toHaveLength(4);
    });

    it("lists only the comments about whole traces when asked", async () => {
      const response = await get("/api/annotations?anchor=trace");
      const { data } = (await response.json()) as {
        data: { comment: string }[];
      };
      expect(data.map((row) => row.comment)).toEqual(["the whole trace is off"]);
    });

    it("refuses a scope it does not recognise", async () => {
      const response = await get("/api/annotations?anchor=everything");
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        error: "validation_error",
      });
    });
  });
});

/**
 * @vitest-environment node
 *
 * A create over REST tells the tenant the experiment list moved.
 *
 * The route has to use the app-layer's own experiment service, because that is
 * the only instance carrying a broadcaster. A route that builds its own writes
 * the row and emits nothing, so an open experiments list shows the new
 * experiment only after a reload.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import { Hono } from "hono";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Project } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { getTestProject } from "~/utils/testUtils";
import { app as publicApp } from "../[[...route]]/app";

wireDefaultTestApp();

describe("creating an experiment over REST", () => {
  let project: Project;
  const createdIds: string[] = [];

  beforeAll(async () => {
    project = await getTestProject("experiments-create-broadcast");
  });

  afterAll(async () => {
    await prisma.experimentVersion.deleteMany({
      where: { experimentId: { in: createdIds }, projectId: project.id },
    });
    await prisma.experiment.deleteMany({
      where: { id: { in: createdIds }, projectId: project.id },
    });
  });

  describe("when the create succeeds", () => {
    /** @scenario A create over REST tells the tenant the list moved */
    it("broadcasts an experiment update to the tenant", async () => {
      const broadcast = vi.spyOn(getApp().broadcast, "broadcastToTenant");

      const response = await new Hono()
        .route("/", publicApp)
        .request("/api/experiments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Token": project.apiKey,
          },
          body: JSON.stringify({ name: `Broadcast ${nanoid(6)}` }),
        });

      const body = (await response.json()) as { id: string; slug: string };
      expect(response.status).toBe(200);
      createdIds.push(body.id);

      expect(broadcast).toHaveBeenCalledWith(
        project.id,
        expect.stringContaining('"event":"experiment_updated"'),
        "experiment_updated",
      );
      const [, payload] = broadcast.mock.calls[0] ?? [];
      expect(JSON.parse(String(payload))).toMatchObject({
        experimentId: body.id,
        slug: body.slug,
        version: 1,
        actorLabel: "api",
      });

      broadcast.mockRestore();
    });
  });
});

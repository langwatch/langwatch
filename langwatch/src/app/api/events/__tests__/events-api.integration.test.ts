import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";

vi.mock(
  "~/server/app-layer/events/track-event.service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("~/server/app-layer/events/track-event.service")
      >();
    return {
      ...actual,
      recordTrackedEventSpan: vi.fn().mockResolvedValue(void 0),
    };
  },
);

import { recordTrackedEventSpan } from "~/server/app-layer/events/track-event.service";
import { app } from "../[[...route]]/app";

describe("Events API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;

  const createAuthHeaders = (apiKey: string) => ({
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
  });

  const post = (body: unknown) =>
    app.request("/api/events/track", {
      method: "POST",
      headers: createAuthHeaders(testApiKey),
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  beforeEach(async () => {
    vi.clearAllMocks();

    testOrganization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `test-org-${nanoid()}`,
      },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });

    testProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
        personalFeatures: {},
      },
    });

    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;
  });

  afterEach(async () => {
    await prisma.project.delete({
      where: { id: testProjectId },
    });

    await prisma.team.delete({
      where: { id: testTeam.id },
    });

    await prisma.organization.delete({
      where: { id: testOrganization.id },
    });
  });

  describe("POST /api/events/track", () => {
    describe("when a custom event type is posted", () => {
      it("records the span and returns 200", async () => {
        const res = await post({
          trace_id: "trace_123",
          event_type: "my_custom_event",
          metrics: { score: 0.5 },
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ message: "Event tracked" });
        expect(recordTrackedEventSpan).toHaveBeenCalledWith(
          expect.objectContaining({
            project: expect.objectContaining({ id: testProjectId }),
            body: expect.objectContaining({
              trace_id: "trace_123",
              event_type: "my_custom_event",
            }),
            eventId: expect.any(String),
          }),
        );
      });
    });

    describe("when a valid predefined event is posted", () => {
      it("returns 200", async () => {
        const res = await post({
          trace_id: "trace_123",
          event_type: "thumbs_up_down",
          metrics: { vote: 1 },
          event_details: { feedback: "great answer" },
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ message: "Event tracked" });
      });
    });

    describe("when a predefined event violates its schema", () => {
      it("returns 400 with a validation error", async () => {
        const res = await post({
          trace_id: "trace_123",
          event_type: "thumbs_up_down",
          metrics: { vote: 2 },
        });

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("vote");
        expect(recordTrackedEventSpan).not.toHaveBeenCalled();
      });
    });

    describe("when the body fails the base schema", () => {
      it("returns 400 with a validation error", async () => {
        const res = await post({ event_type: "thumbs_up_down" });

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBeTruthy();
      });
    });

    describe("when the body is not valid JSON", () => {
      it("returns 400 matching the documented error shape", async () => {
        const res = await post("{not json");

        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: "Bad request" });
      });
    });

    describe("when recording the span fails", () => {
      it("still returns 200", async () => {
        vi.mocked(recordTrackedEventSpan).mockRejectedValueOnce(
          new Error("pipeline down"),
        );

        const res = await post({
          trace_id: "trace_123",
          event_type: "my_custom_event",
          metrics: { score: 1 },
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ message: "Event tracked" });
      });
    });

    describe("when no auth token is provided", () => {
      it("returns 401", async () => {
        const res = await app.request("/api/events/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trace_id: "trace_123",
            event_type: "my_custom_event",
            metrics: {},
          }),
        });

        expect(res.status).toBe(401);
      });
    });
  });
});

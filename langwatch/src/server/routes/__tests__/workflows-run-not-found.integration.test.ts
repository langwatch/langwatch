/**
 * @vitest-environment node
 *
 * POST /api/workflows/:workflowId/run must surface a 404/422 through the
 * real HTTP path, not the raw 500 `handleWorkflowRun` used to hard-code —
 * a review comment on the runWorkflow.ts unit-level fix flagged that the
 * route's own try/catch swallowed the newly typed errors before they ever
 * reached the app's onError(handleError) middleware. This proves the fix
 * end-to-end through the actual Hono route, not just runWorkflow() in
 * isolation (see runWorkflow.not-found.unit.test.ts for that).
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)(
  "POST /api/workflows/:workflowId/run",
  () => {
    const testNamespace = `workflow-run-${nanoid(8)}`;
    let organizationId: string;
    let teamId: string;
    let projectId: string;
    let apiKey: string;
    let unpublishedWorkflowId: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: "Test Org", slug: `--test-org-${testNamespace}` },
      });
      organizationId = organization.id;
      const team = await prisma.team.create({
        data: {
          name: "Test Team",
          slug: `--test-team-${testNamespace}`,
          organizationId,
        },
      });
      teamId = team.id;
      apiKey = `sk-lw-test-${nanoid()}`;
      const project = await prisma.project.create({
        data: {
          name: "Test Project",
          slug: `--test-project-${testNamespace}`,
          apiKey,
          teamId,
          language: "en",
          framework: "test",
        },
      });
      projectId = project.id;

      const workflow = await prisma.workflow.create({
        data: {
          projectId,
          name: "Unpublished Workflow",
          icon: "🧩",
          description: "",
          publishedId: null,
        },
      });
      unpublishedWorkflowId = workflow.id;
    });

    afterAll(async () => {
      await prisma.workflow.delete({ where: { id: unpublishedWorkflowId } });
      await prisma.project.delete({ where: { id: projectId } });
      await prisma.team.delete({ where: { id: teamId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    });

    /** @scenario Running a nonexistent workflow returns 404 */
    it("returns 404 for a nonexistent workflow id", async () => {
      const { app } = await import("../misc");

      const res = await app.request("/api/workflows/nonexistent-workflow/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": apiKey,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("workflow_not_found");
    });

    /** @scenario Running a workflow that has never been published returns 422 */
    it("returns 422 for a workflow that has never been published", async () => {
      const { app } = await import("../misc");

      const res = await app.request(
        `/api/workflows/${unpublishedWorkflowId}/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Auth-Token": apiKey,
          },
          body: JSON.stringify({}),
        },
      );

      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.message).toBe("Workflow not published");
    });
  },
);

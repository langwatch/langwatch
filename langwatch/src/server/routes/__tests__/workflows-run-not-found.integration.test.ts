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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "~/server/db";

// This suite only needs Postgres — every harness (CI's testcontainers,
// native local services) provides that, so it runs unconditionally. Do NOT
// add an `isTestcontainersOnly`/`TEST_CLICKHOUSE_URL` skip guard here: CI
// always sets TEST_CLICKHOUSE_URL for the ClickHouse-dependent suites in
// this same integration run, so that guard would permanently skip this
// file everywhere it matters (caught in review — see PR #5988).
describe(
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
      // The "sk-lw-test-" shape deliberately fails the scoped-API-key regex
      // (api-key-token.utils.ts), so auth falls back to legacyProjectKey —
      // which bypasses the RBAC ceiling check entirely (auth-middleware.ts).
      // A realistic sk-lw-{16}_{48} key would 401 here instead.
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
      // Each delete guarded independently: a partial beforeAll failure must
      // not orphan the rows it did manage to create in the shared test DB.
      if (unpublishedWorkflowId) {
        await prisma.workflow.delete({ where: { id: unpublishedWorkflowId } });
      }
      if (projectId) {
        await prisma.project.delete({ where: { id: projectId } });
      }
      if (teamId) {
        await prisma.team.delete({ where: { id: teamId } });
      }
      if (organizationId) {
        await prisma.organization.delete({ where: { id: organizationId } });
      }
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

    describe("when runWorkflow throws an untyped error", () => {
      afterEach(() => {
        vi.doUnmock("~/server/workflows/runWorkflow");
        vi.resetModules();
      });

      /** @scenario An untyped runWorkflow error still returns a safe 500, not a leaked message */
      it("returns a generic 500 without leaking the internal error message", async () => {
        vi.resetModules();
        vi.doMock("~/server/workflows/runWorkflow", () => ({
          runWorkflow: vi
            .fn()
            .mockRejectedValue(new Error("db connection refused at 10.0.0.5")),
        }));
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

        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: string; message: string };
        expect(body.message).toBe("An unknown error occurred");
        expect(JSON.stringify(body)).not.toContain("10.0.0.5");
      });
    });
  },
);

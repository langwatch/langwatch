/**
 * @vitest-environment node
 *
 * @see specs/workflows/workflow-node-owned-llm.feature
 *
 * POST /api/workflows/post_event with an LLM node that carries no model
 * must fail with a 422 configuration error naming the node — never the
 * pre-fix opaque 500 "Model provider not configured: " (empty provider
 * name from splitting an empty model string). Auth is stubbed at the
 * session boundary; addEnvs runs for real against the real database.
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/server/auth", () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({ user: { id: "user_1" } }),
}));

vi.mock("~/server/api/rbac", async (importActual) => {
  const actual = await importActual<typeof import("~/server/api/rbac")>();
  return { ...actual, hasProjectPermission: vi.fn().mockResolvedValue(true) };
});

import { prisma } from "~/server/db";

const isTestcontainersOnly = !!process.env.TEST_CLICKHOUSE_URL;

describe.skipIf(isTestcontainersOnly)(
  "POST /api/workflows/post_event with a modelless LLM node",
  () => {
    const testNamespace = `post-event-llm-${nanoid(8)}`;
    let organizationId: string;
    let teamId: string;
    let projectId: string;

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
      const project = await prisma.project.create({
        data: {
          name: "Test Project",
          slug: `--test-project-${testNamespace}`,
          apiKey: `sk-lw-test-${nanoid()}`,
          teamId,
          language: "en",
          framework: "test",
        },
      });
      projectId = project.id;
    });

    afterAll(async () => {
      await prisma.project.delete({ where: { id: projectId } });
      await prisma.team.delete({ where: { id: teamId } });
      await prisma.organization.delete({ where: { id: organizationId } });
    });

    /** @scenario Running a workflow with a modelless LLM node is rejected as a fixable problem */
    it("returns 422 with the typed cause and the node name, not an opaque 500", async () => {
      const { app } = await import("../workflows");

      const res = await app.request("/api/workflows/post_event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          event: {
            type: "execute_component",
            payload: {
              trace_id: "trace-1",
              workflow: {
                spec_version: "1.5",
                workflow_id: "wf-1",
                name: "Test Workflow",
                icon: "🧩",
                description: "",
                version: "1.0",
                template_adapter: "default",
                enable_tracing: true,
                state: {},
                nodes: [
                  {
                    id: "llm_call",
                    type: "signature",
                    data: {
                      name: "LLM Call",
                      parameters: [
                        { identifier: "llm", type: "llm", value: undefined },
                      ],
                    },
                  },
                ],
                edges: [],
              },
              node_id: "llm_call",
              inputs: {},
            },
          },
        }),
      });

      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string; cause: string };
      expect(body.cause).toBe("LLM_MODEL_NOT_SET");
      expect(body.error).toContain('LLM node "LLM Call"');
      expect(body.error).not.toContain("Model provider not configured");
    });
  },
);

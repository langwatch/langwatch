/**
 * @vitest-environment node
 *
 * POST /api/scenario/execute-sync, through the real HTTP path and the real
 * auth middleware.
 *
 * Two properties matter here and neither can be checked below the route. The
 * project is bound from the credential, so a key for one project cannot run on
 * another project's engine whatever the body says. And the engine's own status
 * and body are forwarded unchanged, because the adapter on the other end
 * decides between a failed run, a rejected request and a malformed answer from
 * exactly those two values.
 *
 * nlpgoFetch is mocked: how the control plane reaches a project's engine is
 * covered by its own suites, and what this route owes is the binding, the
 * passthrough and the headers it does NOT send.
 *
 * Requires: PostgreSQL database (Prisma)
 */
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { nlpgoFetchMock } = vi.hoisted(() => ({ nlpgoFetchMock: vi.fn() }));

vi.mock("~/server/nlpgo/nlpgoFetch", () => ({ nlpgoFetch: nlpgoFetchMock }));

import { prisma } from "~/server/db";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { LambdaFetchTimeoutError } from "~/utils/lambdaFetch";

wireDefaultTestApp();

/** The engine answered with this status and body. */
function engineAnswers({ status, body }: { status: number; body: string }) {
  nlpgoFetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    enginePath: "go" as const,
    json: async () => JSON.parse(body),
    text: async () => body,
  });
}

/** The options the route handed nlpgoFetch for the last call. */
function sentToEngine(): Record<string, unknown> {
  return nlpgoFetchMock.mock.calls[0]![0] as Record<string, unknown>;
}

describe("POST /api/scenario/execute-sync", () => {
  const testNamespace = `execute-sync-${nanoid(8)}`;
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let otherProjectId: string;
  let apiKey: string;

  const event = {
    type: "execute_flow",
    payload: {
      trace_id: "a".repeat(32),
      do_not_trace: true,
      run_evaluations: false,
      workflow: {
        api_key: "the-dsl-api-key",
        secrets: { TOKEN: "s3cret" },
        params: { seat: 4, loud: false },
      },
      inputs: [{ input: "Hello" }],
    },
  };

  async function relay({
    body = JSON.stringify(event),
    headers = {},
  }: {
    body?: string;
    headers?: Record<string, string>;
  } = {}) {
    const { app } = await import("../scenario-execute-sync");
    return await app.request("/api/scenario/execute-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
  }

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
    // Deliberately not the scoped sk-lw-{16}_{48} shape, so auth resolves it
    // as a legacy project key: that is the credential the scenario child
    // carries, and it bypasses the RBAC ceiling by design.
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
    const other = await prisma.project.create({
      data: {
        name: "Other Project",
        slug: `--test-other-${testNamespace}`,
        apiKey: `sk-lw-test-other-${nanoid()}`,
        teamId,
        language: "en",
        framework: "test",
      },
    });
    otherProjectId = other.id;
  });

  afterAll(async () => {
    if (otherProjectId) {
      await prisma.project.delete({ where: { id: otherProjectId } });
    }
    if (projectId) await prisma.project.delete({ where: { id: projectId } });
    if (teamId) await prisma.team.delete({ where: { id: teamId } });
    if (organizationId) {
      await prisma.organization.delete({ where: { id: organizationId } });
    }
  });

  beforeEach(() => {
    nlpgoFetchMock.mockReset();
    engineAnswers({ status: 200, body: '{"status":"success","result":{}}' });
  });

  describe("given a project key", () => {
    /** @scenario "The project comes from the key" */
    it("runs the turn on that key's own project", async () => {
      await relay({ headers: { "X-Auth-Token": apiKey } });

      expect(sentToEngine().projectId).toBe(projectId);
      expect(sentToEngine().path).toBe("/studio/execute_sync");
    });

    /** @scenario "A body naming another project changes nothing" */
    it("ignores a project named in the body", async () => {
      await relay({
        headers: { "X-Auth-Token": apiKey },
        body: JSON.stringify({ ...event, projectId: otherProjectId }),
      });

      expect(sentToEngine().projectId).toBe(projectId);
    });

    /** @scenario "The body reaches the engine unchanged" */
    it("forwards the api_key, the secrets and the params the adapter wrote", async () => {
      await relay({ headers: { "X-Auth-Token": apiKey } });

      expect(sentToEngine().body).toEqual(event);
    });

    /** @scenario "A relayed turn sends no causality depth" */
    it("sends no causality depth, so monitors still fire on what the run produces", async () => {
      await relay({ headers: { "X-Auth-Token": apiKey } });

      expect(sentToEngine()).not.toHaveProperty("causalityDepth");
      expect(sentToEngine()).not.toHaveProperty("parentTrace");
      expect(sentToEngine().origin).toBe("scenario");
    });

    /** @scenario "A caller that goes away cancels the invoke" */
    it("hands the caller's own socket down, so a stopped run cancels the invoke", async () => {
      await relay({ headers: { "X-Auth-Token": apiKey } });

      expect(sentToEngine().signal).toBeInstanceOf(AbortSignal);
      expect(sentToEngine().timeoutMs).toBeGreaterThan(0);
    });
  });

  describe("given no credential", () => {
    /** @scenario "A turn with no credential is refused" */
    it("refuses the turn and reaches no engine", async () => {
      const response = await relay();

      expect(response.status).toBe(401);
      expect(nlpgoFetchMock).not.toHaveBeenCalled();
    });
  });

  describe("given a credential that resolves to no project", () => {
    it("refuses the turn and reaches no engine", async () => {
      const response = await relay({
        headers: { "X-Auth-Token": "not-a-real-key" },
      });

      expect(response.status).toBe(401);
      expect(nlpgoFetchMock).not.toHaveBeenCalled();
    });
  });

  describe("what the caller reads back", () => {
    /** @scenario "A successful run passes through" */
    it("reads the engine's status and body on a successful run", async () => {
      const body = '{"status":"success","result":{"output":"hi"}}';
      engineAnswers({ status: 200, body });

      const response = await relay({ headers: { "X-Auth-Token": apiKey } });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(body);
    });

    /** @scenario "A rejected request passes through" */
    it("reads the engine's own status and body on a rejected request", async () => {
      const body = '{"error":{"message":"bad workflow"}}';
      engineAnswers({ status: 422, body });

      const response = await relay({ headers: { "X-Auth-Token": apiKey } });

      expect(response.status).toBe(422);
      expect(await response.text()).toBe(body);
    });

    /** @scenario "A failed run passes through as the 200 it is" */
    it("reads a 200 and the error envelope when the customer's code raised", async () => {
      const body =
        '{"status":"error","error":{"message":"ZeroDivisionError","traceback":"line 3"}}';
      engineAnswers({ status: 200, body });

      const response = await relay({ headers: { "X-Auth-Token": apiKey } });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(body);
    });

    it("reads a non-JSON engine answer unchanged, so the adapter can name it", async () => {
      nlpgoFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "",
        enginePath: "go" as const,
        json: async () => {
          throw new Error("not json");
        },
        text: async () => "<html>a proxy answered</html>",
      });

      const response = await relay({ headers: { "X-Auth-Token": apiKey } });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("<html>a proxy answered</html>");
    });
  });

  describe("given a body that is not JSON", () => {
    it("refuses it before reaching any engine", async () => {
      const response = await relay({
        headers: { "X-Auth-Token": apiKey },
        body: "not json at all",
      });

      expect(response.status).toBe(400);
      expect(nlpgoFetchMock).not.toHaveBeenCalled();
    });
  });

  describe("given a turn whose workflow is several megabytes", () => {
    /** @scenario "A large turn is accepted" */
    it("accepts it and forwards the whole body", async () => {
      const big = {
        ...event,
        payload: {
          ...event.payload,
          inputs: [{ input: "x".repeat(6_000_000) }],
        },
      };

      const response = await relay({
        headers: { "X-Auth-Token": apiKey },
        body: JSON.stringify(big),
      });

      expect(response.status).toBe(200);
      expect(sentToEngine().body).toEqual(big);
    });
  });

  describe("given a turn that outlives the platform's maximum", () => {
    /** @scenario "A turn past the platform's ceiling is refused as a timeout" */
    it("tells the caller the engine did not answer in time", async () => {
      nlpgoFetchMock.mockRejectedValue(
        new LambdaFetchTimeoutError({
          path: "/go/studio/execute_sync",
          timeoutMs: 900_000,
        }),
      );

      const response = await relay({ headers: { "X-Auth-Token": apiKey } });

      expect(response.status).toBe(504);
    });
  });
});

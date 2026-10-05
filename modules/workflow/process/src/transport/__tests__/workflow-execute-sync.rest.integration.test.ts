/**
 * @vitest-environment node
 * `POST /api/scenario/execute-sync` over the runtime a process mounts it on, with the relay service
 * behind it and only the engine faked. specs/scenarios/execute-sync-relay.feature
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowNlpDispatchInput, WorkflowNlpRuntime } from "../../app/workflow.app.ts";
import {
  NlpInvokeAbortedError,
  NlpInvokeTimeoutError,
} from "../../channels/workflow-nlp-lambda.channel.ts";
import { WorkflowExecuteSyncRelayService } from "../../services/workflow-execute-sync-relay.service.ts";
import { workflowExecuteSyncRest } from "../workflow-execute-sync.rest.ts";

const PATH = "/api/scenario/execute-sync";
const CEILING_MS = 900_000;

class UnauthenticatedTestError extends HandledError {
  constructor() {
    super("unauthorized", "No credential", { httpStatus: 401 });
  }
}

function engineAnswer({ status, body }: { status: number; body: string }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => JSON.parse(body) as unknown,
    text: async () => body,
  };
}

function mount({
  dispatch,
  authenticated = true,
}: {
  dispatch: WorkflowNlpRuntime["dispatch"];
  authenticated?: boolean;
}) {
  const asked: string[] = [];
  const relay = WorkflowExecuteSyncRelayService.create({
    runtime: { dispatch },
    turnCeilingMs: CEILING_MS,
  });
  const runtime = createRestRuntime({
    identity: {
      authenticate: ({ permission }) => {
        if (!authenticated) throw new UnauthenticatedTestError();
        if (permission) asked.push(permission);
        return { actor: null, scope: { tier: "project", id: "project_key" } };
      },
    },
  });
  const app = runtime.mount(workflowExecuteSyncRest.router(), {
    app: () =>
      createApiFixture<WorkflowApi>(
        { relayExecuteSync: (input) => relay.relay(input) },
        "WorkflowApi",
      ),
    credential: "project",
    onError: canonicalErrorResponse,
  });
  return { app, asked };
}

function post(app: ReturnType<typeof mount>["app"], body: string, signal?: AbortSignal) {
  return app.request(PATH, {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-token": "sk-lw-key" },
    body,
    ...(signal ? { signal } : {}),
  });
}

const EVENT = {
  type: "execute_flow",
  payload: {
    workflow: { api_key: "sk-lw-key", secrets: { TOKEN: "s3cret" }, params: { temperature: 0 } },
  },
};

describe("POST /api/scenario/execute-sync", () => {
  describe("given a project key", () => {
    /** @scenario "The project comes from the key" */
    it("runs the turn on the key's project, asking scenarios:create", async () => {
      const dispatch = vi.fn(async () => engineAnswer({ status: 200, body: "{}" }));
      const { app, asked } = mount({ dispatch });

      const response = await post(app, JSON.stringify(EVENT));

      expect(response.status).toBe(200);
      expect(asked).toEqual(["scenarios:create"]);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "project_key", origin: "scenario" }),
      );
    });

    /** @scenario "A body naming another project changes nothing" */
    it("ignores a project the event names", async () => {
      const dispatch = vi.fn(async () => engineAnswer({ status: 200, body: "{}" }));
      const { app } = mount({ dispatch });
      const event = {
        ...EVENT,
        project_id: "project_other",
        payload: { ...EVENT.payload, project_id: "project_other" },
      };

      const response = await post(app, JSON.stringify(event));

      expect(response.status).toBe(200);
      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({ projectId: "project_key", body: event });
    });

    // Main forwarded this too; the framework refuses any input whose projectId is not the key's.
    it("refuses a top-level projectId naming another project, reaching no engine", async () => {
      const dispatch = vi.fn(async () => engineAnswer({ status: 200, body: "{}" }));
      const { app } = mount({ dispatch });

      const response = await post(app, JSON.stringify({ ...EVENT, projectId: "project_other" }));

      expect(response.status).toBe(403);
      expect(dispatch).not.toHaveBeenCalled();
    });

    /** @scenario "The body reaches the engine unchanged" */
    it("forwards the api_key, secrets and params exactly as written", async () => {
      const dispatch = vi.fn(async () => engineAnswer({ status: 200, body: "{}" }));
      const { app } = mount({ dispatch });

      await post(app, JSON.stringify(EVENT));

      expect(dispatch.mock.calls[0]?.[0].body).toEqual(EVENT);
    });

    /** @scenario "A relayed turn sends no causality depth" */
    it("sends no causality depth and no parent trace, under the platform's ceiling", async () => {
      const dispatch = vi.fn(async () => engineAnswer({ status: 200, body: "{}" }));
      const { app } = mount({ dispatch });

      await post(app, JSON.stringify(EVENT));

      const sent: WorkflowNlpDispatchInput | undefined = dispatch.mock.calls[0]?.[0];
      expect(sent).not.toHaveProperty("causalityDepth");
      expect(sent).not.toHaveProperty("parentTrace");
      expect(sent?.timeoutMs).toBe(CEILING_MS);
    });

    /** @scenario "A large turn is accepted" */
    it("accepts a workflow of several megabytes and forwards all of it", async () => {
      const dispatch = vi.fn(async () => engineAnswer({ status: 200, body: "{}" }));
      const { app } = mount({ dispatch });
      const event = { ...EVENT, payload: { dataset: "x".repeat(8 * 1024 * 1024) } };

      const response = await post(app, JSON.stringify(event));

      expect(response.status).toBe(200);
      expect(dispatch.mock.calls[0]?.[0].body).toEqual(event);
    });
  });

  describe("given no credential", () => {
    /** @scenario "A turn with no credential is refused" */
    it("refuses as unauthenticated and reaches no engine", async () => {
      const dispatch = vi.fn(async () => engineAnswer({ status: 200, body: "{}" }));
      const { app } = mount({ dispatch, authenticated: false });

      const response = await post(app, JSON.stringify(EVENT));

      expect(response.status).toBe(401);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("given the engine answers", () => {
    /** @scenario "A successful run passes through" */
    it("passes a result through unchanged", async () => {
      const body = '{"status":"success","result":{"output":"hi"}}';
      const { app } = mount({ dispatch: async () => engineAnswer({ status: 200, body }) });

      const response = await post(app, JSON.stringify(EVENT));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(body);
    });

    /** @scenario "A rejected request passes through" */
    it("passes a non-2xx and its error envelope through unchanged", async () => {
      const body = '{"type":"error","payload":{"message":"invalid dsl"}}';
      const { app } = mount({ dispatch: async () => engineAnswer({ status: 422, body }) });

      const response = await post(app, JSON.stringify(EVENT));

      expect(response.status).toBe(422);
      expect(await response.text()).toBe(body);
    });

    /** @scenario "A failed run passes through as the 200 it is" */
    it("passes a failed run through as a 200 with the engine's envelope", async () => {
      const body = '{"status":"error","error":"ZeroDivisionError"}';
      const { app } = mount({ dispatch: async () => engineAnswer({ status: 200, body }) });

      const response = await post(app, JSON.stringify(EVENT));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(body);
    });
  });

  describe("given a turn in flight", () => {
    /** @scenario "A caller that goes away cancels the invoke" */
    it("cancels the invoke when the caller goes, answering 408", async () => {
      const controller = new AbortController();
      let seen: AbortSignal | undefined;
      const dispatch = vi.fn(
        (input: WorkflowNlpDispatchInput) =>
          new Promise<ReturnType<typeof engineAnswer>>((_resolve, reject) => {
            seen = input.signal;
            input.signal?.addEventListener("abort", () =>
              reject(new NlpInvokeAbortedError({ path: "/studio/execute_sync" })),
            );
            controller.abort();
          }),
      );
      const { app } = mount({ dispatch });

      const response = await post(app, JSON.stringify(EVENT), controller.signal);

      expect(seen?.aborted).toBe(true);
      expect(response.status).toBe(408);
      expect(await response.json()).toEqual({ error: "The caller went away" });
    });

    /** @scenario "A turn past the platform's ceiling is refused as a timeout" */
    it("answers 504 when the ceiling passes", async () => {
      const { app } = mount({
        dispatch: async () => {
          throw new NlpInvokeTimeoutError({ path: "/studio/execute_sync", timeoutMs: CEILING_MS });
        },
      });

      const response = await post(app, JSON.stringify(EVENT));

      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ error: "The engine did not answer in time" });
    });
  });

  it("answers a body that is not JSON with the 400 malformed_request", async () => {
    const dispatch = vi.fn(async () => engineAnswer({ status: 200, body: "{}" }));
    const { app } = mount({ dispatch });

    const response = await post(app, "not json");

    expect(response.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

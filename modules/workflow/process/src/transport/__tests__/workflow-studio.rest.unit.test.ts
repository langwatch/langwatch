import { createApiFixture } from "@langwatch/api-fixture";
/** @vitest-environment node */
import {
  bindRestMiddleware,
  canonicalErrorResponse,
  createRestRuntime,
  type RestCaller,
} from "@langwatch/api/rest";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import { workflowStudioRest, workflowStudioSession } from "../workflow-studio.rest.ts";

const signedIn: RestCaller = { actor: { type: "user", id: "user_1" }, scope: null };

function mount({ app, caller }: { app: Partial<WorkflowApi>; caller: RestCaller | null }) {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("the studio doors never authenticate a permission");
      },
      identify: () => {
        if (!caller) throw new Error("no session");

        return caller;
      },
      identifyOptional: () => caller,
    },
  });

  return runtime.mount(workflowStudioRest.router(), {
    app: () => createApiFixture<WorkflowApi>(app, "WorkflowApi"),
    credential: "browser",
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(workflowStudioSession, () =>
        caller?.actor?.type === "user" ? { user: { id: caller.actor.id } } : null,
      ),
    ],
  });
}

describe("the Studio editor's doors", () => {
  /** @scenario The Studio event door hands the app the signed-in browser session */
  it("hands a posted event the signed-in user rather than nobody", async () => {
    const streamStudioEvent = vi.fn(async () => (async function* () {})());
    const hono = mount({ app: { streamStudioEvent }, caller: signedIn });

    const response = await hono.request("/api/workflows/post_event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project_1", event: { type: "is_alive", payload: {} } }),
    });

    expect(response.status).toBe(200);
    expect(streamStudioEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: "user_1" }));
  });
});

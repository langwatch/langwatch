/**
 * `GET /api/traces/settle-settings`: the project's recommended verdict-time trace wait, which
 * the scenario SDK reads before it judges. See specs/scenarios/judge-trace-wait-settings.feature.
 */
import {
  bindMiddlewareContext,
  canonicalErrorResponse,
  createRestRuntime,
  projectRequestContext,
  UnauthorizedError,
} from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { settleSettingsFromSample } from "../../features/read/rules/trace-settle-settings.rules.ts";
import { tracesRest, tracesRestCredential } from "../traces.rest.ts";

function mount() {
  const resolveTraceSettleSettings = vi.fn<TraceApi["resolveTraceSettleSettings"]>(async () =>
    settleSettingsFromSample(null),
  );
  const stub = createApiFixture<TraceApi>({ resolveTraceSettleSettings });

  const runtime = createRestRuntime({
    audit: { record: () => {} },
    identity: {
      authenticate: ({ request }) => {
        if (request.headers.get("x-auth-token") !== "sk-lw-test") throw new UnauthorizedError();
        return {
          actor: { type: "user" as const, id: "user-1" },
          scope: { tier: "project" as const, id: "project-1" },
        };
      },
    },
    authorization: restTestAuthorization(),
  });

  const hono = runtime.mount(tracesRest.router(), {
    app: () => stub,
    credential: "project",
    onError: canonicalErrorResponse,
    middlewareContext: [
      bindMiddlewareContext(projectRequestContext, () => ({
        projectSlug: "project-one",
        viewerUserId: null,
        actorId: "user-1",
      })),
      bindMiddlewareContext(tracesRestCredential, () => ({ principal: null })),
    ],
  });

  const send = (path: string, headers: Record<string, string> = { "X-Auth-Token": "sk-lw-test" }) =>
    hono.request(`http://api.test${path}`, { method: "GET", headers });

  return { send, resolveTraceSettleSettings };
}

describe("GET /api/traces/settle-settings", () => {
  describe("given a project API key and a project with no history", () => {
    /** @scenario "The SDK asks the project's recommended settle settings" */
    it("answers the default wait, extension and quiet period for the key's project", async () => {
      const { send, resolveTraceSettleSettings } = mount();

      for (const path of ["/api/traces/settle-settings", "/api/v1/traces/settle-settings"]) {
        const response = await send(path);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          waitTimeoutMs: 30_000,
          waitExtensionMs: 30_000,
          quietPeriodMs: 7_000,
        });
      }
      expect(resolveTraceSettleSettings).toHaveBeenCalledWith({ projectId: "project-1" });
    });
  });

  describe("given no valid key", () => {
    /** @scenario "The settle settings route refuses a request without a valid key" */
    it("answers 401 and never measures", async () => {
      const { send, resolveTraceSettleSettings } = mount();

      const response = await send("/api/traces/settle-settings", {});

      expect(response.status).toBe(401);
      expect(resolveTraceSettleSettings).not.toHaveBeenCalled();
    });
  });
});

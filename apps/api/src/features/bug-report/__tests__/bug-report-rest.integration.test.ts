/**
 * `POST /api/bug-reports` through the real Hono app the API process mounts —
 * `runtime.mount` over the ops module's own application.
 * @see specs/support/bug-reports.feature
 */
// @vitest-environment node
import { HandledError } from "@langwatch/handled-error";
import type { OpsApi } from "@langwatch/ops-contract";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountBugReportRest } from "../bug-report-rest.mount.ts";

const validReport = {
  source: "cli",
  kind: "summary",
  title: "the run stopped answering",
  summary: "it hung after the third tool call",
};

describe("given the public issue-report intake", () => {
  describe("when a coding agent files a well-formed report", () => {
    it("answers 201 with the stored id, unlinked without a credential", async () => {
      const submitBugReport = vi.fn(async () => ({ id: "bugreport_1" }));
      const world = mount({ submitBugReport });

      const response = await world.send("/api/bug-reports", {
        method: "POST",
        body: validReport,
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ id: "bugreport_1" });
      expect(submitBugReport).toHaveBeenCalledWith(
        expect.objectContaining({ apiToken: undefined, projectIdHint: null }),
      );
    });
  });

  describe("when the report carries a project credential", () => {
    it("reads it as a bound fact and passes it through to the application", async () => {
      const submitBugReport = vi.fn(async () => ({ id: "bugreport_2" }));
      const world = mount({ submitBugReport });

      await world.send("/api/bug-reports", {
        method: "POST",
        headers: { authorization: "Bearer lw_key" },
        body: validReport,
      });

      expect(submitBugReport).toHaveBeenCalledWith(
        expect.objectContaining({ apiToken: "lw_key", projectIdHint: null }),
      );
    });
  });

  describe("when the body is neither JSON nor a report", () => {
    it("answers 400 for each, without reaching the application", async () => {
      const submitBugReport = vi.fn(async () => ({ id: "unreached" }));
      const world = mount({ submitBugReport });

      const notJson = await world.send("/api/bug-reports", { method: "POST", raw: "{" });
      expect(notJson.status).toBe(400);
      await expect(notJson.json()).resolves.toEqual({ error: "Invalid body, expecting JSON" });

      const noProse = await world.send("/api/bug-reports", {
        method: "POST",
        body: { source: "cli", kind: "summary", title: "hello" },
      });
      expect(noProse.status).toBe(400);
      await expect(noProse.json()).resolves.toMatchObject({ error: "Invalid report" });

      expect(submitBugReport).not.toHaveBeenCalled();
    });
  });

  describe("when the caller has already filled the window", () => {
    it("answers the handled refusal as `{ error, code }` rather than a generic envelope", async () => {
      const submitBugReport = vi.fn(async () => {
        throw new HandledError("agent_report_rate_limited", "Too many reports, try again later", {
          httpStatus: 429,
          fault: "customer",
        });
      });
      const world = mount({ submitBugReport });

      const response = await world.send("/api/bug-reports", { method: "POST", body: validReport });

      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toEqual({
        error: "Too many reports, try again later",
        code: "agent_report_rate_limited",
      });
    });
  });
});

// ---------------------------------------------------------------------------

function mount(overrides: { submitBugReport: OpsApi["submitBugReport"] }) {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
  const runtime = createApiRestRuntime({
    projectCredential: () => {
      throw new Error("This door resolves no project credential of its own.");
    },
    organizationCredential: () => {
      throw new Error("This door resolves no organization credential of its own.");
    },
    organizationIdentity: () => {
      throw new Error("This door resolves no organization credential of its own.");
    },
    routeAuthorization: () => {
      throw new Error("This suite authorizes no route-scoped permission.");
    },
    errors,
  });

  const ops = { submitBugReport: overrides.submitBugReport } as OpsApi;
  const mounted = mountBugReportRest(runtime, { ops: () => ops });
  const hono = new Hono().route("/", mounted);

  return {
    send: (
      path: string,
      init: { method?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {},
    ) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          method: init.method ?? "GET",
          headers: { "Content-Type": "application/json", ...init.headers },
          ...(init.raw !== undefined
            ? { body: init.raw }
            : init.body === undefined
              ? {}
              : { body: JSON.stringify(init.body) }),
        }),
      ),
  };
}

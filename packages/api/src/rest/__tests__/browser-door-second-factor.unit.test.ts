/** @vitest-environment node */
/**
 * A browser-door route asks the organization's second-factor requirement at the scope it was
 * permitted at, as the tRPC door does. @see specs/identity/mfa-and-session-shape.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizeDefaults } from "../../__tests__/api-double.ts";
import type { Authorize } from "../../access/access.ts";
import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

class HeldAtTheGateError extends HandledError {
  constructor() {
    super("identity_mfa_enrollment_required", "held at the second-factor gate", {
      httpStatus: 403,
    });
  }
}

type ThingsApi = { read(input: { projectId: string }): Promise<{ ok: boolean }> };

const ThingsApi = moduleApi<ThingsApi>()("workflow");

function mounted({ held }: { held: boolean }) {
  const read = vi.fn(async (_input: { projectId: string }) => ({ ok: true }));
  const assertSecondFactor = vi.fn<NonNullable<Authorize["assertSecondFactor"]>>(async () => {
    if (held) throw new HeldAtTheGateError();
  });
  const authorize: Authorize = {
    ...authorizeDefaults,
    getDecision: async () => ({ permitted: true, organizationRole: "MEMBER" }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: "MEMBER" }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
    organizationOf: async () => "org_acme",
    projectKindOf: async () => "application",
    assertSecondFactor,
  };
  const routes = defineRestRouter(ThingsApi)
    .withNamespace("things")
    .withVersion("2026-10-09")
    .withCredential("browser")
    .withAddressing("literal", { v1Twin: false })
    .get("/api/things/:projectId", "read")
    .withParams(z.object({ projectId: z.string() }))
    .withPermission("workflows:manage", { at: "route", param: "projectId" })
    .withOutput(z.object({ ok: z.boolean() }))
    .handle(({ app, input }) => app.read({ projectId: input.projectId }))
    .build()
    .router();
  const server = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("a browser route never authenticates a key");
      },
      identify: () => ({
        actor: { type: "user", id: "sam" },
        scope: null,
        browserSession: { id: "session-1" },
      }),
      authorize: () => ({ permitted: true, organizationRole: "MEMBER" }),
    },
    authorization: { forRequest: () => authorize },
  }).mount(routes, { app: () => ({ read }), credential: "browser", onError: createErrorHandler() });

  return { read, assertSecondFactor, send: () => server.request("/api/things/project_1") };
}

describe("given a person in a browser session reaching a project by a REST route", () => {
  describe("when their organization holds them at the second-factor gate", () => {
    it("refuses before the handler runs", async () => {
      const { read, send } = mounted({ held: true });

      const response = await send();

      expect(response.status).toBe(403);
      expect(await response.text()).toContain("identity_mfa_enrollment_required");
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe("when they satisfy the requirement", () => {
    it("asks once at the permitted project, with their session, and answers", async () => {
      const { read, assertSecondFactor, send } = mounted({ held: false });

      expect((await send()).status).toBe(200);
      expect(assertSecondFactor).toHaveBeenCalledExactlyOnceWith({
        userId: "sam",
        sessionId: "session-1",
        organizationId: "org_acme",
        scope: { tier: "project", id: "project_1" },
      });
      expect(read).toHaveBeenCalledOnce();
    });
  });
});

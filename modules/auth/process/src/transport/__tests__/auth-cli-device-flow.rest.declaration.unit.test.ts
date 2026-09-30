/**
 * @vitest-environment node
 * The device grant's eight addresses, pinned: released builds poll them.
 * @see specs/ai-governance/cli-onboarding/login-unified.feature
 */
import { describe, expect, it } from "vitest";

import { authCliDeviceFlowRest } from "../auth-cli-device-flow.rest.ts";

const declaration = authCliDeviceFlowRest.router();

describe("the /api/auth/cli REST family", () => {
  describe("given the declaration a process mounts", () => {
    it("publishes its paths literally and keeps the /api/v1 twin they answered under", () => {
      expect(authCliDeviceFlowRest.namespace).toBe("auth-cli");
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(true);
    });

    it("keeps every path, operation id and method", () => {
      expect(
        declaration.routes.map((route) => [route.path, route.operation, route.methods]),
      ).toEqual([
        ["/api/auth/cli/device-code", "startCliDeviceCode", ["post"]],
        ["/api/auth/cli/exchange", "exchangeCliDeviceCode", ["post"]],
        ["/api/auth/cli/refresh", "refreshCliDeviceSession", ["post"]],
        ["/api/auth/cli/lookup", "lookupCliDeviceCode", ["get"]],
        ["/api/auth/cli/approve", "approveCliDeviceCode", ["post"]],
        ["/api/auth/cli/deny", "denyCliDeviceCode", ["post"]],
        ["/api/auth/cli/logout", "endCliDeviceSession", ["post"]],
        ["/api/auth/cli/device-approval", "watchCliDeviceApproval", ["get"]],
      ]);
    });

    it("resolves no credential at the door: the flow authenticates in its own handlers", () => {
      for (const route of declaration.routes) {
        expect([route.operation, route.access?.kind]).toEqual([route.operation, "public"]);
        expect([route.operation, route.permission]).toEqual([route.operation, undefined]);
      }
    });

    it("reads its own body on every write, so a malformed one is the flow's own refusal", () => {
      const bodied = declaration.routes.filter((route) => route.method !== "get");

      expect(bodied.map((route) => [route.operation, route.rawBody?.form])).toEqual(
        bodied.map((route) => [route.operation, "text"]),
      );
    });

    it("writes OAuth's own bodies rather than a schema's, and streams the approval wake-up", () => {
      for (const route of declaration.routes) {
        const kind = route.operation === "watchCliDeviceApproval" ? "sse" : "protocol";
        expect([route.operation, route.response?.kind]).toEqual([route.operation, kind]);
      }
    });

    it("takes the pending grant's code off the query string on the browser's read", () => {
      const lookup = declaration.routes.find((route) => route.operation === "lookupCliDeviceCode");

      expect(Object.keys(lookup?.query?.shape ?? {})).toEqual(["user_code"]);
    });
  });
});

/**
 * THE CLI EXCHANGE, PINNED BYTE FOR BYTE.
 *
 * The other side of this wire is the published `langwatch` binary: it prints the
 * verification URI, the reader approves here, and the CLI's `/exchange` poll
 * picks up the record these calls flip. So the paths, the method, the header and
 * the snake-cased body are a compatibility surface with software that is already
 * installed — not an internal detail a refactor may adjust.
 *
 * Every assertion below is the platform page's behaviour restated as a
 * transport-level one. Where the old suite mocked `globalThis.fetch` inside a
 * page render and read the bodies off the mock, this drives the three functions
 * directly, which is what makes the status-code branches legible: 404 and 410 are
 * DIFFERENT outcomes, and collapsing either into "failed" costs the reader the
 * one sentence that tells them what to do next.
 *
 * Specs: specs/ai-governance/cli-onboarding/login-unified.feature,
 *        specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveCliDeviceCode,
  denyCliDeviceCode,
  lookupCliDeviceCode,
} from "../src/behavior/ui-cli-device-flow";

const fetchMock = vi.fn();

/** A response, as `fetch` hands one back. */
function answer({
  status = 200,
  body = {},
  json = true,
}: {
  status?: number;
  body?: unknown;
  json?: boolean;
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: json ? () => Promise.resolve(body) : () => Promise.reject(new Error("not json")),
  };
}

/** The one request the call under test made. */
function requestBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("given a device code is looked up", () => {
  describe("when the record is still pending", () => {
    it("asks the lookup route with the code in the query string, and reads what it answered", async () => {
      fetchMock.mockResolvedValue(
        answer({
          body: {
            user_code: "WDJB-MJHT",
            status: "pending",
            expires_at: 1_900_000_000_000,
            credential_type: "project_api_key",
          },
        }),
      );

      const result = await lookupCliDeviceCode("WDJB-MJHT");

      expect(fetchMock).toHaveBeenCalledWith("/api/auth/cli/lookup?user_code=WDJB-MJHT");
      expect(result).toEqual({
        outcome: "pending",
        userCode: "WDJB-MJHT",
        status: "pending",
        expiresAt: 1_900_000_000_000,
        credentialType: "project_api_key",
      });
    });

    it("escapes a code that would otherwise change the query string", async () => {
      fetchMock.mockResolvedValue(
        answer({ body: { user_code: "a&b", status: "pending", expires_at: 1 } }),
      );
      await lookupCliDeviceCode("a&b=1");
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/cli/lookup?user_code=a%26b%3D1");
    });

    it("defaults to a device session for a deployment that does not send the discriminator", async () => {
      fetchMock.mockResolvedValue(
        answer({ body: { user_code: "WDJB-MJHT", status: "pending", expires_at: 1 } }),
      );
      const result = await lookupCliDeviceCode("WDJB-MJHT");
      expect(result).toMatchObject({ credentialType: "device_session" });
    });

    it("ignores a credential type it does not recognise rather than trusting it", async () => {
      fetchMock.mockResolvedValue(
        answer({
          body: {
            user_code: "WDJB-MJHT",
            status: "pending",
            expires_at: 1,
            credential_type: "root_certificate",
          },
        }),
      );
      const result = await lookupCliDeviceCode("WDJB-MJHT");
      expect(result).toMatchObject({ credentialType: "device_session" });
    });
  });

  describe("when the record has passed its deadline", () => {
    it("reads 410 as expired, which is the one state that tells the reader to start over", async () => {
      fetchMock.mockResolvedValue(answer({ status: 410, body: { error: "expired" } }));
      expect(await lookupCliDeviceCode("WDJB-MJHT")).toEqual({ outcome: "expired" });
    });
  });

  describe("when nothing recognises the code", () => {
    it("reads 404 as unknown, separately from expired", async () => {
      fetchMock.mockResolvedValue(answer({ status: 404, body: { error: "not_found" } }));
      expect(await lookupCliDeviceCode("WDJB-MJHT")).toEqual({ outcome: "unknown" });
    });
  });

  describe("when the route fails some other way", () => {
    it("shows the description it sent", async () => {
      fetchMock.mockResolvedValue(
        answer({ status: 401, body: { error_description: "Sign in to continue" } }),
      );
      expect(await lookupCliDeviceCode("WDJB-MJHT")).toEqual({
        outcome: "failed",
        message: "Sign in to continue",
      });
    });

    it("names the status when the body carries no description at all", async () => {
      fetchMock.mockResolvedValue(answer({ status: 500, json: false }));
      expect(await lookupCliDeviceCode("WDJB-MJHT")).toEqual({
        outcome: "failed",
        message: "Lookup failed (500)",
      });
    });

    it("reports a network failure as itself", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      expect(await lookupCliDeviceCode("WDJB-MJHT")).toEqual({
        outcome: "failed",
        message: "Failed to fetch",
      });
    });
  });
});

describe("given a device session is approved", () => {
  describe("when the reader reviewed a key selection", () => {
    it("posts the selection under the names the route parses", async () => {
      fetchMock.mockResolvedValue(answer({ body: { ok: true } }));

      await approveCliDeviceCode({
        userCode: "WDJB-MJHT",
        organizationId: "org_1",
        keySelection: {
          bindings: [
            { scopeType: "TEAM", scopeId: "team_1" },
            { scopeType: "PROJECT", scopeId: "proj_1" },
          ],
          permissions: ["traces:view", "datasets:manage"],
        },
      });

      const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(path).toBe("/api/auth/cli/approve");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(requestBody()).toEqual({
        user_code: "WDJB-MJHT",
        organization_id: "org_1",
        key_selection: {
          bindings: [
            { scope_type: "TEAM", scope_id: "team_1" },
            { scope_type: "PROJECT", scope_id: "proj_1" },
          ],
          permissions: ["traces:view", "datasets:manage"],
        },
      });
      // A device session names no project: sending one would change which
      // credential the exchange mints.
      expect(requestBody()).not.toHaveProperty("project_id");
    });
  });

  describe("when the CLI asked for a project key", () => {
    it("posts the project and no key selection at all", async () => {
      fetchMock.mockResolvedValue(answer({ body: { ok: true } }));

      await approveCliDeviceCode({
        userCode: "WDJB-MJHT",
        organizationId: "org_1",
        projectId: "proj_1",
      });

      expect(requestBody()).toEqual({
        user_code: "WDJB-MJHT",
        organization_id: "org_1",
        project_id: "proj_1",
      });
    });
  });

  describe("when the approval is refused", () => {
    it("prefers the handled message over the route's own description", async () => {
      fetchMock.mockResolvedValue(
        answer({
          status: 403,
          body: {
            message: "Not an active member of the organization",
            error_description: "forbidden",
          },
        }),
      );
      expect(
        await approveCliDeviceCode({ userCode: "WDJB-MJHT", organizationId: "org_1" }),
      ).toEqual({
        outcome: "failed",
        message: "Not an active member of the organization",
      });
    });

    it("falls back to the description, then to the status", async () => {
      fetchMock.mockResolvedValue(
        answer({ status: 410, body: { error_description: "Code has expired" } }),
      );
      expect(
        await approveCliDeviceCode({ userCode: "WDJB-MJHT", organizationId: "org_1" }),
      ).toEqual({ outcome: "failed", message: "Code has expired" });

      fetchMock.mockResolvedValue(answer({ status: 500, json: false }));
      expect(
        await approveCliDeviceCode({ userCode: "WDJB-MJHT", organizationId: "org_1" }),
      ).toEqual({ outcome: "failed", message: "Approval failed (500)" });
    });

    it("reports a network failure as itself", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      expect(
        await approveCliDeviceCode({ userCode: "WDJB-MJHT", organizationId: "org_1" }),
      ).toEqual({ outcome: "failed", message: "Failed to fetch" });
    });
  });
});

describe("given the reader denies the request", () => {
  it("posts the code and nothing else", async () => {
    fetchMock.mockResolvedValue(answer({ body: {} }));
    await denyCliDeviceCode("WDJB-MJHT");
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/auth/cli/deny");
    expect(init.method).toBe("POST");
    expect(requestBody()).toEqual({ user_code: "WDJB-MJHT" });
  });

  it("counts as denied even when the call could not be made", async () => {
    // The code expires by itself, so telling the reader their refusal did not
    // go through would ask them to worry about something they cannot act on.
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await denyCliDeviceCode("WDJB-MJHT")).toEqual({ outcome: "ok" });
  });
});

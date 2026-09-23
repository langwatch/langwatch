// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the directory asked, and what we answered (ADR-126). Evidence, not
 * truth: it is filed after the request was served, it never fails one, and
 * nothing that could not be attributed to an organization is filed at all.
 */
import {
  ScimProtocolError,
  type ScimRequestRecord,
  type ScimTokenEntitlement,
} from "@langwatch/enterprise-scim-contract";
import { fromDate, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { ScimRequestLogService } from "../../services/scim-request-log.service.ts";
import {
  ScimServiceFake,
  scimTestApp,
} from "../../transport/__tests__/support/scim-app.fixture.ts";

const ORGANIZATION = "org-acme";
const CONNECTION = "conn-okta";

function directory(entitlement: ScimTokenEntitlement): ScimServiceFake {
  const scim = new ScimServiceFake();
  scim.verifyToken.mockResolvedValue(entitlement);

  return scim;
}

function recordedBy(scim: ScimServiceFake): ScimRequestRecord[] {
  return scim.recordRequest.mock.calls.map(([record]) => record);
}

describe("the SCIM request log", () => {
  /** @scenario "A request the directory makes is recorded with what we answered" */
  it("records a served request against the connection that made it", async () => {
    const scim = new ScimServiceFake();
    scim.createUser.mockResolvedValue({ id: "user-1" });
    const { app } = scimTestApp({ scim });

    await app.createUser({
      organizationId: ORGANIZATION,
      connectionId: CONNECTION,
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "a@b.test",
      }),
    });

    expect(recordedBy(scim)).toEqual([
      {
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        method: "POST",
        resource: "Users",
        status: 201,
        reason: null,
        detail: null,
      },
    ]);
  });

  /** @scenario "A refusal we can attribute is recorded as a refusal" */
  it("records a refusal with a reason a customer can act on", async () => {
    const scim = new ScimServiceFake();
    scim.getUser.mockRejectedValue(
      new ScimProtocolError({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "404",
        detail: "User not found",
      }),
    );
    const { app } = scimTestApp({ scim });

    await expect(
      app.getUser({ organizationId: ORGANIZATION, id: "nobody" }),
    ).rejects.toBeInstanceOf(ScimProtocolError);

    expect(recordedBy(scim)).toEqual([
      {
        organizationId: ORGANIZATION,
        connectionId: null,
        method: "GET",
        resource: "Users/:id",
        status: 404,
        reason: "not_found",
        detail: "User not found",
      },
    ]);
  });

  /** @scenario "A refusal we can attribute is recorded as a refusal" */
  it("records a lapsed plan against the connection its token names", async () => {
    const scim = directory({
      status: "plan_not_entitled",
      organizationId: ORGANIZATION,
      connectionId: CONNECTION,
    });
    const { app } = scimTestApp({ scim });

    await expect(
      app.authenticateDirectory({
        authorization: "Bearer scim-token",
        method: "POST",
        path: "/api/scim/v2/Users",
      }),
    ).rejects.toBeInstanceOf(ScimProtocolError);

    expect(recordedBy(scim)).toEqual([
      expect.objectContaining({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        method: "POST",
        resource: "Users",
        status: 403,
        reason: "plan_not_entitled",
      }),
    ]);
  });

  /** @scenario "A request we cannot attribute is answered and not recorded" */
  it("records nothing for a token nothing issued", async () => {
    const scim = directory({ status: "invalid_token" });
    const { app } = scimTestApp({ scim });

    await expect(
      app.authenticateDirectory({
        authorization: "Bearer nobodys-token",
        method: "POST",
        path: "/api/scim/v2/Users",
      }),
    ).rejects.toBeInstanceOf(ScimProtocolError);

    expect(scim.recordRequest).not.toHaveBeenCalled();
  });

  /** @scenario "The log never carries the credential that was presented" */
  it("carries no bearer, no hash of one and no header", async () => {
    const scim = new ScimServiceFake();
    scim.listUsers.mockResolvedValue({ Resources: [] });
    const { app } = scimTestApp({ scim });

    await app.listUsers({ organizationId: ORGANIZATION, connectionId: CONNECTION });

    const filed = JSON.stringify(recordedBy(scim));
    expect(filed).not.toContain("Bearer");
    expect(Object.keys(recordedBy(scim)[0] ?? {}).toSorted()).toEqual([
      "connectionId",
      "detail",
      "method",
      "organizationId",
      "reason",
      "resource",
      "status",
    ]);
  });

  it("answers the request even when the evidence cannot be filed", async () => {
    const store = {
      recordRequest: vi.fn(async () => {
        throw new Error("the log is unavailable");
      }),
      findRequestLog: vi.fn(async () => []),
      findExpiredRequestIds: vi.fn(async () => []),
      deleteRequests: vi.fn(async () => 0),
    };

    await expect(
      ScimRequestLogService.create(store).record({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        method: "GET",
        resource: "Users",
        status: 200,
        reason: null,
        detail: null,
      }),
    ).resolves.toBeUndefined();
  });

  /** @scenario "Requests older than the window are dropped" */
  it("sweeps what has aged out, counting what went and stopping on a short batch", async () => {
    const expired = [["a", "b"], ["c"]];
    const store = {
      recordRequest: vi.fn(async () => undefined),
      findRequestLog: vi.fn(async () => []),
      findExpiredRequestIds: vi.fn(
        async (_input: { before: Instant; limit: number }) => expired.shift() ?? [],
      ),
      deleteRequests: vi.fn(async ({ ids }: { ids: readonly string[] }) => ids.length),
    };

    const swept = await ScimRequestLogService.create(store).sweepExpired({
      now: fromDate(new Date("2026-09-22T00:00:00Z")),
    });

    // A batch shorter than the ceiling is the end of the backlog, so a quiet
    // table costs exactly one statement and the second batch is never asked for.
    expect(swept).toBe(2);
    expect(store.findExpiredRequestIds).toHaveBeenCalledExactlyOnceWith({
      before: fromDate(new Date("2026-08-23T00:00:00Z")),
      limit: 5_000,
    });
  });

  /** @scenario "An absent request is not evidence that it never happened" */
  it("reads one connection's requests newest first, and says only what it holds", async () => {
    const store = {
      recordRequest: vi.fn(async () => undefined),
      findRequestLog: vi.fn(async () => []),
      findExpiredRequestIds: vi.fn(async () => []),
      deleteRequests: vi.fn(async () => 0),
    };

    await expect(
      ScimRequestLogService.create(store).findForConnection({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        limit: 50,
      }),
    ).resolves.toEqual([]);
    expect(store.findRequestLog).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      connectionId: CONNECTION,
      limit: 50,
    });
  });
});

describe("the reconciliation overview", () => {
  describe("given an organization whose plan does not include directory sync", () => {
    it("refuses with the plan code, while the request log stays readable", async () => {
      const { app } = scimTestApp({ scim: new ScimServiceFake(), planType: "FREE" });

      await expect(
        app.getDirectoryReconciliation({ organizationId: ORGANIZATION }),
      ).rejects.toMatchObject({ code: "enterprise_plan_required" });
      await expect(
        app.findDirectoryRequests({ organizationId: ORGANIZATION, connectionId: CONNECTION }),
      ).resolves.toEqual([]);
    });
  });
});

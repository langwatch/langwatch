import { type Authorization, sealAuthorization } from "@langwatch/authorization";
import { describe, expect, it } from "vitest";

import { tracesFenceOf } from "../coding-agent-traces-fence.rules.ts";

const NOW = Date.parse("2026-11-26T12:00:00.000Z");

function proof(grants: Parameters<typeof sealAuthorization>[0]["grants"]): Authorization {
  const actor = { type: "user", id: "viewer" } as const;
  return sealAuthorization({
    actor,
    principal: actor,
    scope: { organizationId: "org_acme" },
    grants,
    expiresAt: NOW + 60_000,
    purpose: { kind: "route", route: "test" },
  });
}

const aggregate = proof([
  { projectId: "aggregate", permissions: ["traces:view"], via: [], kind: "own" },
  {
    projectId: "member",
    permissions: ["traces:view"],
    via: ["grant_1"],
    kind: "shared",
    condition: { type: "trace", from: NOW - 1000, until: NOW },
  },
]);

describe("tracesFenceOf", () => {
  it("admits own projects at any time and shared members only inside their window", () => {
    const fence = tracesFenceOf(aggregate);
    if (fence.kind !== "fenced") throw new Error("expected a fence");
    expect(fence.admits({ tenantId: "aggregate", atMs: 0 })).toBe(true);
    expect(fence.admits({ tenantId: "member", atMs: NOW - 500 })).toBe(true);
    expect(fence.admits({ tenantId: "member", atMs: NOW })).toBe(false);
    expect(fence.admits({ tenantId: "member", atMs: NOW - 2000 })).toBe(false);
    expect(fence.admits({ tenantId: "stranger", atMs: NOW - 500 })).toBe(false);
  });

  it("refuses a proof with no own traces:view grant", () => {
    const shared = proof([
      {
        projectId: "member",
        permissions: ["traces:view"],
        via: ["grant_1"],
        kind: "shared",
        condition: { type: "trace", from: 0, until: null },
      },
    ]);
    expect(tracesFenceOf(shared)).toEqual({ kind: "refused" });
  });
});

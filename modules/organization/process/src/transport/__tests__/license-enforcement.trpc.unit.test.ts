import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
import type { LimitCheckResult, OrganizationApi } from "@langwatch/organization-contract";
/**
 * @vitest-environment node
 *
 * `licenseEnforcement.*` on organization's router: the three procedure names
 * the clients call, readable by any member, the caller forwarded whole.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { licenseEnforcementTrpcTransport } from "../license-enforcement.trpc.ts";
import { organizationSessionPersonFact } from "../organization.trpc.ts";

type TestContext = {
  actor: { id: string };
  person: { name: string | null; email: string | null } | null;
};

const MEMBERS_ANSWER: LimitCheckResult = {
  allowed: true,
  current: 3,
  max: 5,
  limitType: "members",
};

const checkLimit = vi.fn<OrganizationApi["checkLimit"]>();
const reportLimitBlocked = vi.fn<OrganizationApi["reportLimitBlocked"]>();
const asked: string[] = [];

const members = trpcTestMembers<TestContext>({
  permits: (permission) => {
    asked.push(permission);

    return true;
  },
});

const app = createApiFixture<OrganizationApi>({ checkLimit, reportLimitBlocked });
const trpc = initTRPC.context<TestContext>().create();
const router = createTrpcRuntime<TestContext>({
  root: trpc,
  procedure: trpc.procedure,
  members,
}).mount(licenseEnforcementTrpcTransport, () => app, {
  facts: [bindTrpcFact(organizationSessionPersonFact, (ctx) => ctx.person)],
});
const caller = router.createCaller({
  actor: { id: "user_ana" },
  person: { name: "Ana", email: "ana@acme.com" },
});

describe("licenseEnforcement on organization's router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asked.length = 0;
  });

  it("exposes exactly the procedure names the clients call", () => {
    expect(Object.keys(router._def.procedures).toSorted()).toEqual([
      "checkAllLimits",
      "checkLimit",
      "reportLimitBlocked",
    ]);
  });

  /** @scenario "Any member may read the members limit" */
  it("answers the members limit to a caller holding organization:view", async () => {
    checkLimit.mockResolvedValue(MEMBERS_ANSWER);

    await expect(
      caller.checkLimit({ organizationId: "org_acme", limitType: "members" }),
    ).resolves.toEqual(MEMBERS_ANSWER);
    expect(asked).toEqual(["organization:view"]);
    expect(checkLimit).toHaveBeenCalledWith(
      { organizationId: "org_acme", limitType: "members" },
      { id: "user_ana", name: "Ana", email: "ana@acme.com" },
    );
  });

  it("files a blocked report as a mutation that answers nothing", async () => {
    reportLimitBlocked.mockResolvedValue(undefined);

    await expect(
      caller.reportLimitBlocked({ organizationId: "org_acme", limitType: "membersLite" }),
    ).resolves.toBeUndefined();
    expect(asked).toEqual(["organization:view"]);
  });
});

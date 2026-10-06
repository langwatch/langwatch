/**
 * @vitest-environment node
 * The `twoStepVerification.standing` read over the real tRPC runtime: who may ask, and what is
 * read when they do.
 * @see specs/identity/mfa-and-session-shape.feature
 */
import { bindTrpcFact, browserSessionFact, createTrpcRuntime } from "@langwatch/api/trpc";
import type { TwoStepVerificationApi } from "@langwatch/identity-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import {
  twoStepRequestHeadersFact,
  twoStepVerificationTrpcTransport,
} from "../two-step-verification.trpc.ts";

type StandingContext = { actor: { id: string } | null };

const ACME = "acme";

function mount() {
  const asked: string[] = [];
  const api = createApiFixture<TwoStepVerificationApi>({
    getOrganizationMfaStanding: async ({ organizationId }) => {
      asked.push(organizationId);
      throw new Error("the standing read must not be reached");
    },
  });
  const trpc = initTRPC.context<StandingContext>().create();
  const router = createTrpcRuntime<StandingContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<StandingContext>(),
  }).mount(twoStepVerificationTrpcTransport, () => api, {
    facts: [
      bindTrpcFact(browserSessionFact, () => null),
      bindTrpcFact(twoStepRequestHeadersFact, () => null),
    ],
  });

  return { asked, anonymous: router.createCaller({ actor: null }) };
}

describe("the twoStepVerification.standing procedure", () => {
  describe("given an organization that requires two-step verification", () => {
    describe("when a caller with no authenticated person asks for standing", () => {
      /** @scenario "A standing read still requires an authenticated person" */
      it("refuses the request before any organization standing is read", async () => {
        const { anonymous, asked } = mount();

        await expect(anonymous.standing({ organizationId: ACME })).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
        expect(asked).toEqual([]);
      });
    });
  });
});

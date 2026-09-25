/**
 * @vitest-environment node
 * The `twoStepVerification.*` procedures, under main's namespace.
 * @see specs/identity/mfa-and-session-shape.feature
 */
import { twoStepVerificationTrpc } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { twoStepVerificationTrpcTransport } from "../two-step-verification.trpc.ts";

describe("the twoStepVerification tRPC surface", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps main's namespace, procedure names and kinds", () => {
      expect(twoStepVerificationTrpcTransport.namespace).toBe("twoStepVerification");
      expect(
        Object.fromEntries(
          Object.entries(twoStepVerificationTrpc.members).map(([name, member]) => [
            name,
            member.kind,
          ]),
        ),
      ).toEqual({
        account: "query",
        disable: "mutation",
        standing: "query",
        requirement: "query",
        setRequirement: "mutation",
        memberFactors: "query",
      });
    });

    it("takes nothing from the browser for the account read: the session names the person", () => {
      const parsed = twoStepVerificationTrpc.members.account?.input.safeParse({ userId: "other" });

      expect(parsed?.data).toEqual({});
    });

    it("refuses a member list with no organization named", () => {
      const parsed = twoStepVerificationTrpc.members.memberFactors?.input.safeParse({
        organizationId: "",
      });

      expect(parsed?.success).toBe(false);
    });

    it("answers a member's factors with how they would meet the requirement", () => {
      const parsed = twoStepVerificationTrpc.members.memberFactors?.output.safeParse([
        {
          userId: "user_ana",
          name: "Ana",
          email: "ana@acme.test",
          accountEnrollmentEnabled: false,
          passkeyCount: 1,
          satisfaction: { satisfied: false, by: "none" },
        },
      ]);

      expect(parsed?.success).toBe(true);
    });
  });
});

/**
 * @vitest-environment node
 * @see specs/identity/signin-router.feature
 */
import type { RoutingDecision, SignInMethod } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { SignUpEnrollmentService } from "../sign-up-enrollment.service.ts";

const PASSWORD: SignInMethod = { id: "password", kind: "password", connectionId: null };
const PASSKEY: SignInMethod = { id: "passkey", kind: "passkey", connectionId: null };
const OKTA: SignInMethod = { id: "okta", kind: "federated", connectionId: "conn_acme" };

function enrollment({
  decision,
  proofHolds = true,
  taken = false,
  defaults = [PASSWORD, PASSKEY],
  passwordAllowed = true,
}: {
  decision: RoutingDecision;
  proofHolds?: boolean;
  taken?: boolean;
  defaults?: readonly SignInMethod[];
  passwordAllowed?: boolean;
}) {
  const asked: { routed: (string | null)[]; takenFor: string[] } = { routed: [], takenFor: [] };
  const service = SignUpEnrollmentService.create({
    validateAddressProof: async () => proofHolds,
    route: async ({ identifier }) => {
      asked.routed.push(identifier);
      return decision;
    },
    addressIsTaken: async ({ email }) => {
      asked.takenFor.push(email);
      return taken;
    },
    resolveDefaultMethods: async () => defaults,
    passwordIsAllowed: async () => passwordAllowed,
  });

  return { service, asked };
}

const UNKNOWN: RoutingDecision = {
  outcome: "route_to_signup",
  methodSet: [],
  reasonCode: "no_domain_match",
};

describe("SignUpEnrollmentService", () => {
  describe("when the proof does not hold for the address", () => {
    it("refuses by code before routing anything", async () => {
      const { service, asked } = enrollment({ decision: UNKNOWN, proofHolds: false });

      await expect(
        service.getEnrollment({ email: "sam@example.com", addressProof: "stale" }),
      ).rejects.toMatchObject({ code: "auth_no_address_to_confirm" });
      expect(asked.routed).toEqual([]);
    });
  });

  describe("when an unknown address outside any managed domain proves itself", () => {
    /** @scenario "Sign-up offers a password where the deployment issues its own" */
    it("offers the deployment's default methods", async () => {
      const { service } = enrollment({ decision: UNKNOWN });

      await expect(
        service.getEnrollment({ email: "sam@example.com", addressProof: "proof" }),
      ).resolves.toEqual({
        outcome: "enroll",
        methodSet: [PASSWORD, PASSKEY],
        reasonCode: "no_domain_match",
      });
    });

    it("drops the password where the deployment offers none", async () => {
      const { service } = enrollment({ decision: UNKNOWN, passwordAllowed: false });

      await expect(
        service.getEnrollment({ email: "sam@example.com", addressProof: "proof" }),
      ).resolves.toMatchObject({ outcome: "enroll", methodSet: [PASSKEY] });
    });

    it("is unavailable when nothing is left to enrol", async () => {
      const { service } = enrollment({
        decision: UNKNOWN,
        defaults: [PASSWORD],
        passwordAllowed: false,
      });

      await expect(
        service.getEnrollment({ email: "sam@example.com", addressProof: "proof" }),
      ).resolves.toEqual({ outcome: "unavailable", methodSet: [], reasonCode: "no_domain_match" });
    });
  });

  describe("when the domain is governed by a connection", () => {
    /** @scenario "Sign-up offers a password where the deployment issues its own" */
    it("hands the address to that connection", async () => {
      const { service } = enrollment({
        decision: {
          outcome: "redirect_to_connection",
          connectionId: "conn_acme",
          methodSet: [OKTA],
          reasonCode: "domain_routed",
        },
      });

      await expect(
        service.getEnrollment({ email: "sam@acme.com", addressProof: "proof" }),
      ).resolves.toEqual({ outcome: "redirect", methodSet: [OKTA], reasonCode: "domain_routed" });
    });

    it("refuses enrollment while the connection is suspended", async () => {
      const { service } = enrollment({
        decision: { outcome: "method_picker", methodSet: [], reasonCode: "connection_suspended" },
      });

      await expect(
        service.getEnrollment({ email: "sam@acme.com", addressProof: "proof" }),
      ).resolves.toEqual({
        outcome: "unavailable",
        methodSet: [],
        reasonCode: "connection_suspended",
      });
    });
  });

  describe("when the address already holds an account", () => {
    it("does not adopt it into a new enrollment, asking by the normalised address", async () => {
      const { service, asked } = enrollment({ decision: UNKNOWN, taken: true });

      await expect(
        service.getEnrollment({ email: " Sam@Example.com ", addressProof: "proof" }),
      ).resolves.toEqual({
        outcome: "existing_account",
        methodSet: [],
        reasonCode: "account_methods",
      });
      expect(asked.takenFor).toEqual(["sam@example.com"]);
    });
  });
});

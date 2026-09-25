/**
 * @vitest-environment node
 * The `identity.*` procedures and the shapes they take.
 * @see specs/identity/identifier-model.feature
 */
import { identityTrpc } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { identityTrpcTransport } from "../identity.trpc.ts";

const CHALLENGE = "a".repeat(43);

describe("the identity tRPC surface", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps main's namespace, procedures and kinds", () => {
      expect(identityTrpcTransport.namespace).toBe("identity");
      expect(
        Object.fromEntries(
          Object.entries(identityTrpc.members).map(([name, member]) => [name, member.kind]),
        ),
      ).toEqual({
        completeVerification: "mutation",
        myTestArrival: "query",
        myIdentifiers: "query",
        myMethodsLastUsed: "query",
        addEmailIdentifier: "mutation",
        resendIdentifierConfirmation: "mutation",
        removeIdentifier: "mutation",
      });
    });

    /** @scenario "A sign-in through a connection that is not live yet is a test arrival" */
    it("answers a test arrival with the connection and organization, or not one", () => {
      const standing = identityTrpc.members.myTestArrival?.output.safeParse({
        testing: true,
        connectionId: "local_ssoc_one",
        organizationId: "org_acme",
        organizationName: "Acme",
      });
      const nobody = identityTrpc.members.myTestArrival?.output.safeParse({ testing: false });

      expect(standing?.success).toBe(true);
      expect(nobody?.success).toBe(true);
    });

    it("takes nothing from the browser: the session names whose standing it is", () => {
      const parsed = identityTrpc.members.myTestArrival?.input.safeParse({
        connectionId: "local_ssoc_other",
      });

      expect(parsed?.data).toEqual({});
    });

    it("demands both proofs together, so a forwarded link verifies nothing", () => {
      const parsed = identityTrpc.members.completeVerification?.input.safeParse({
        identifierId: "identifier-1",
        verificationId: "verification-1",
        token: "token-1",
      });

      expect(parsed?.success).toBe(false);
    });

    it("refuses a code verifier outside the unreserved set RFC 7636 fixes", () => {
      const parsed = identityTrpc.members.completeVerification?.input.safeParse({
        identifierId: "identifier-1",
        verificationId: "verification-1",
        token: "token-1",
        codeVerifier: "too-short",
      });

      expect(parsed?.success).toBe(false);
    });

    it("takes an address and an S256 challenge to add one, and nothing shorter", () => {
      const add = identityTrpc.members.addEmailIdentifier?.input;

      expect(add?.validate({ email: "sam@acme.com", codeChallenge: CHALLENGE })).toBe(true);
      expect(add?.validate({ email: "sam@acme.com", codeChallenge: "short" })).toBe(false);
      expect(add?.validate({ email: "not-an-address", codeChallenge: CHALLENGE })).toBe(false);
    });
  });
});

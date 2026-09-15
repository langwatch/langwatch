/**
 * @vitest-environment node
 * The one `identity.*` procedure and the shape it takes.
 * @see specs/identity/identifier-model.feature
 */
import { identityTrpc } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { identityTrpcTransport } from "../identity.trpc.ts";

describe("the identity tRPC surface", () => {
  describe("given the declaration a process mounts", () => {
    it("keeps the namespace and the one procedure the verification link calls", () => {
      expect(identityTrpcTransport.namespace).toBe("identity");
      expect(Object.keys(identityTrpc.members)).toEqual(["completeVerification"]);
      expect(identityTrpc.members.completeVerification?.kind).toBe("mutation");
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
  });
});

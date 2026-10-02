import { describe, expect, it } from "vitest";

import {
  CONNECTION_IDP_UPDATED_EVENT_TYPE,
  emptySsoConnection,
  reduceSsoConnection,
  type SsoConnectionFact,
  type SsoConnectionState,
  ssoConnectionIdpIsEditable,
} from "../index.ts";

/**
 * What an identity provider update leaves on the connection, and what it leaves
 * alone: the id keys the redirect address, so only the dialing information moves.
 */

const T0 = 1_756_000_000_000;
const CONNECTION_ID = "ssoconn_acme";

const updated = (idp: {
  issuer: string | null;
  clientIdRef: string | null;
  secretRef: string | null;
  certRefs: string[];
}): SsoConnectionFact => ({
  type: CONNECTION_IDP_UPDATED_EVENT_TYPE,
  occurredAt: T0 + 1_000,
  data: {
    connectionId: CONNECTION_ID,
    idp,
    actor: { type: "user", id: "user_ana" },
    source: "self-serve",
  },
});

const live = (): SsoConnectionState => ({
  ...emptySsoConnection({ connectionId: CONNECTION_ID }),
  organizationId: "org_acme",
  state: "ACTIVE",
  verifiedDomains: ["acme.com"],
  arrivalPolicy: "admit",
  arrivalPolicyDecidedAtMs: T0,
  testLoginAccountId: "acct_ana",
  idpMetadata: {
    issuer: "https://login.microsoftonline.com/wrong-tenant/v2.0",
    providerId: "Acme Entra",
    clientIdRef: "cred_client_0",
    secretRef: "cred_secret_0",
    certRefs: [],
  },
});

describe("given an administrator replacing a connection's identity provider settings", () => {
  describe("when the update is folded in", () => {
    /** @scenario "Editing the identity provider keeps the connection id and redirect address" */
    it("dials the new settings and keeps the id, name, domains and policy", () => {
      const before = live();
      const after = reduceSsoConnection({
        state: before,
        fact: updated({
          issuer: "https://login.microsoftonline.com/right-tenant/v2.0",
          clientIdRef: "cred_client_1",
          secretRef: "cred_secret_1",
          certRefs: [],
        }),
      });

      expect(after.idpMetadata).toEqual({
        issuer: "https://login.microsoftonline.com/right-tenant/v2.0",
        providerId: "Acme Entra",
        clientIdRef: "cred_client_1",
        secretRef: "cred_secret_1",
        certRefs: [],
      });
      expect(after.connectionId).toBe(before.connectionId);
      expect(after.state).toBe("ACTIVE");
      expect(after.verifiedDomains).toEqual(before.verifiedDomains);
      expect(after.arrivalPolicy).toBe(before.arrivalPolicy);
      expect(after.arrivalPolicyDecidedAtMs).toBe(before.arrivalPolicyDecidedAtMs);
      expect(after.testLoginAccountId).toBe(before.testLoginAccountId);
      expect(after.updatedAtMs).toBe(T0 + 1_000);
    });
  });
});

describe("where identity provider settings may be replaced", () => {
  describe("when the connection is live or still being set up", () => {
    /** @scenario "A live connection can be edited" */
    it.each([
      "DRAFT",
      "CLAIMED",
      "APPROVED",
      "REJECTED",
      "VERIFICATION_PENDING",
      "VERIFIED",
      "ACTIVE",
      "SUSPENDED",
    ])("allows it from %s", (state) => {
      expect(ssoConnectionIdpIsEditable(state)).toBe(true);
    });
  });

  describe("when the connection is on its way out or gone", () => {
    /** @scenario "A connection being removed cannot be edited" */
    it.each(["TEARDOWN_PENDING", "DISCARDED", "TORN_DOWN"])("refuses it from %s", (state) => {
      expect(ssoConnectionIdpIsEditable(state)).toBe(false);
    });
  });
});

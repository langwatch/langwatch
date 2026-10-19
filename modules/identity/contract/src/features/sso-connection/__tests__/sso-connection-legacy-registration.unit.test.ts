/**
 * Spec: modules/identity/specs/sso-connection-legacy-registration.feature
 */
import { describe, expect, it } from "vitest";

import {
  CONNECTION_REGISTERED_EVENT_TYPE,
  connectionRegisteredPayloadSchema,
  emptySsoConnection,
  reduceSsoConnection,
  type SsoConnectionFact,
} from "../../../index.ts";

/** A registration as the log stored it between 2026-08-25 and 2026-09-21. */
function storedRegistration(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    connectionId: "ssoconn_acme",
    organizationId: "org_acme",
    type: "oidc",
    idp: { issuer: null, providerId: "Okta", clientIdRef: null, secretRef: null, certRefs: [] },
    actor: { type: "user", id: "user_ana" },
    source: "legacy-grandfathered",
    ...extra,
  };
}

/** Reads a stored registration the way every fold does: the payload schema, then the reducer. */
function read(extra: Record<string, unknown>) {
  const data = connectionRegisteredPayloadSchema.parse(storedRegistration(extra));
  const fact = { type: CONNECTION_REGISTERED_EVENT_TYPE, occurredAt: 1, data } as SsoConnectionFact;
  return {
    data,
    state: reduceSsoConnection({ state: emptySsoConnection({ connectionId: "" }), fact }),
  };
}

describe("given a connection registration stored before the arrival policy existed", () => {
  describe("when it provisioned unknown people", () => {
    /** @scenario "A registration that let unknown people in reads as admitting them" */
    it("reads as admitting them", () => {
      const { data, state } = read({ allowsJit: true });
      expect(data.arrivalPolicy).toBe("admit");
      expect(data).not.toHaveProperty("allowsJit");
      expect(state.arrivalPolicy).toBe("admit");
    });
  });

  describe("when it provisioned nobody", () => {
    /** @scenario "A registration that kept unknown people out reads as refusing them" */
    it("reads as refusing them", () => {
      expect(read({ allowsJit: false }).state.arrivalPolicy).toBe("refuse");
    });
  });

  describe("when it states neither", () => {
    /** @scenario "A registration that states neither reads as the default policy" */
    it("reads as the default policy", () => {
      expect(read({}).state.arrivalPolicy).toBe("refuse");
      expect(read({ arrivalPolicy: null }).state.arrivalPolicy).toBe("refuse");
    });
  });
});

describe("given a connection registration that states an arrival policy", () => {
  /** @scenario "A registration that states an arrival policy reads as written" */
  it("reads as written and still refuses a policy outside the three answers", () => {
    expect(read({ arrivalPolicy: "request", allowsJit: true }).state.arrivalPolicy).toBe("request");
    const refused = connectionRegisteredPayloadSchema.safeParse(
      storedRegistration({ arrivalPolicy: "auto" }),
    );
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]).toMatchObject({
      code: "invalid_value",
      path: ["arrivalPolicy"],
    });
  });
});

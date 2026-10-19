import { DEFAULT_SSO_ARRIVAL_POLICY, emptySsoConnection } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { routableSsoConnectionOf } from "../sso-connection-routing.rules.ts";

/**
 * Spec: specs/identity/sso-activation.feature
 */

describe("routableSsoConnectionOf", () => {
  describe("when the connection's history carries no arrivals answer", () => {
    /** @scenario "A connection registered before the question turns new arrivals away" */
    it("answers refuse and routes no arrival in", () => {
      const connection = emptySsoConnection({ connectionId: "conn_acme" });

      expect(connection.arrivalPolicy).toBe(DEFAULT_SSO_ARRIVAL_POLICY);
      expect(connection.arrivalPolicy).toBe("refuse");
      expect(routableSsoConnectionOf({ connection, dial: "conn_acme" }).allowsJit).toBe(false);
    });
  });

  describe("when the connection answers who it admits", () => {
    /** @scenario "Each answer says whether an arrival is provisioned" */
    it.each([
      { arrivalPolicy: "admit", provisions: true },
      { arrivalPolicy: "request", provisions: true },
      { arrivalPolicy: "refuse", provisions: false },
    ] as const)(
      "provisions the arrival: $provisions when the answer is $arrivalPolicy",
      ({ arrivalPolicy, provisions }) => {
        const connection = { ...emptySsoConnection({ connectionId: "conn_acme" }), arrivalPolicy };

        expect(routableSsoConnectionOf({ connection, dial: "conn_acme" }).allowsJit).toBe(
          provisions,
        );
      },
    );
  });
});

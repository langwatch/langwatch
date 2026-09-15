/** @vitest-environment node */

/**
 * The gateway's handled errors, and the three properties that made them
 * worth writing: assertions are on `code`, `fault` and `meta` — never the
 * sentence, since customer-facing words come from the presentation registry
 * keyed by `code` (ADR-045). That registry lives outside this package, so
 * only the half the feature owns is pinned here.
 */
import { describe, expect, it } from "vitest";

import {
  GatewayGroupBudgetUnsupportedError,
  GatewayScopeOrgMismatchError,
  GatewaySpendUnavailableError,
  VirtualKeyNotFoundError,
} from "../index.ts";

describe("gateway handled errors", () => {
  describe("given a scope from another organization", () => {
    /** @scenario "A cross-organization scope is refused without naming the record" */
    it("names the kind of scope and never its id", () => {
      const error = new GatewayScopeOrgMismatchError("team");

      expect(error.code).toBe("gateway_scope_org_mismatch");
      expect(error.fault).toBe("customer");
      expect(error.meta).toEqual({ scope_type: "team" });

      // The id is the whole point: it belongs to a record in an organization
      // this caller has no part in, and the message it used to sit inside
      // handed both it and ours back to whoever probed.
      // Matched on the ID SHAPE (a prefix followed by a generated suffix),
      // not the bare prefix — `gateway_scope_org_mismatch` legitimately
      // contains "org_", and a test that trips on its own code name teaches
      // nothing.
      const serialized = JSON.stringify(new GatewayScopeOrgMismatchError("team").serialize());
      expect(serialized).not.toMatch(/\b(?:organization|project|team|tm|org|prj)_[A-Za-z0-9]{8,}/);
    });
  });

  /**
   * The key may exist and simply not be visible to this caller. Answering
   * "forbidden" there would confirm it exists — an existence oracle for keys in
   * teams the caller has no part in — so both answers must be the same code.
   */
  describe("given a virtual key the caller cannot see", () => {
    /** @scenario "A virtual key the caller cannot see is indistinguishable from a missing one" */
    it("answers exactly as a missing key does", () => {
      const missing = new VirtualKeyNotFoundError();
      const invisible = new VirtualKeyNotFoundError();

      expect(invisible.code).toBe(missing.code);
      expect(invisible.httpStatus).toBe(missing.httpStatus);
      expect(invisible.serialize()).toEqual(missing.serialize());
      expect(missing.httpStatus).toBe(404);
    });
  });

  describe("given a deployment that cannot do what was asked", () => {
    /** @scenario "A limit of the deployment is not blamed on the customer" */
    it("attributes the refusal to the platform and names no engine", () => {
      for (const error of [
        new GatewayGroupBudgetUnsupportedError(),
        new GatewaySpendUnavailableError(),
      ]) {
        expect(error.fault).toBe("platform");

        // The wire message is customer-safe on its own account: the REST
        // boundary ships it, so it may name no engine even before the
        // code-keyed registry replaces it with the words a customer reads.
        const words = error.message.toLowerCase();
        for (const internal of ["clickhouse", "postgres", "redis", "ledger"]) {
          expect(words).not.toContain(internal);
        }
      }
    });
  });
});

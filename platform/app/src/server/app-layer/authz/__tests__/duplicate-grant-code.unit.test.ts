/**
 * `role_binding_already_exists` is one contract, currently raised by two
 * classes: `DuplicateGrantError` (the canonical thrower, on every path that
 * goes through GrantsService) and `RoleBindingAlreadyExistsError` (the legacy
 * REST service, until it moves onto GrantsService too). A customer who hits
 * the conflict must not be able to tell which path answered.
 *
 * The storage-level signal the ledger writer raises carries the same code, so
 * a caller that matches by `code` — the house rule — keeps its 409 whether it
 * caught the port's error or the service's.
 */
import {
  DuplicateBindingError,
  DuplicateGrantError,
} from "@langwatch/authz-server";
import { describe, expect, it } from "vitest";
import { RoleBindingAlreadyExistsError } from "~/server/role-bindings/errors";

describe("given the two classes that raise role_binding_already_exists", () => {
  const canonical = new DuplicateGrantError();
  const legacyRest = new RoleBindingAlreadyExistsError();

  describe("when a caller matches on the code", () => {
    it("gets the same code from either", () => {
      expect(canonical.code).toBe("role_binding_already_exists");
      expect(legacyRest.code).toBe("role_binding_already_exists");
    });
  });

  describe("when the boundary serialises one", () => {
    it("answers the same status and the same customer-safe message", () => {
      expect(canonical.httpStatus).toBe(legacyRest.httpStatus);
      expect(canonical.httpStatus).toBe(409);
      expect(canonical.message).toBe(legacyRest.message);
    });

    it("blames the customer on both, so neither pages an engineer", () => {
      expect(canonical.fault).toBe(legacyRest.fault);
      expect(canonical.fault).toBe("customer");
    });
  });
});

describe("given the port's storage-level duplicate signal", () => {
  describe("when a caller matches on the code rather than the class", () => {
    it("reads the same code the customer-facing error carries", () => {
      expect(new DuplicateBindingError().code).toBe(
        "role_binding_already_exists",
      );
    });
  });
});

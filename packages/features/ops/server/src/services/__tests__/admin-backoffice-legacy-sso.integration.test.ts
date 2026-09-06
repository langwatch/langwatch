/**
 * The backoffice's organization edit, composed the way the process composes
 * it, with the routing flip on. Integration level: the refusal is raised in
 * the ops adapter's own service graph and the copy a reader sees is read from
 * the presentation registry, so nothing here is a restatement of the rule.
 *
 * Spec: specs/identity/sso-onboarding-tiers.feature
 */
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { explainHandledError } from "@langwatch/handled-error/presentation";
import { describe, expect, it } from "vitest";
import { PostgresOpsAdapter } from "../../adapters/postgres.ops.adapter";
import { AuditStub, AuthStub, organizationEdit, UsersStub } from "./support/backoffice-doubles";

/** Reached only if the refusal fails to happen; every call here is a failure. */
const refuseEveryQuery = new Proxy(
  {},
  {
    get: () =>
      new Proxy(
        {},
        {
          get:
            () =>
            (...args: unknown[]) => {
              throw new Error(`the backoffice reached storage: ${JSON.stringify(args)}`);
            },
        },
      ),
  },
);

function backoffice() {
  return PostgresOpsAdapter.create({
    database: refuseEveryQuery as never,
    audit: new AuditStub(),
    adminEmails: ["olive@example.com"],
    users: new UsersStub(),
    auth: new AuthStub(),
    legacySsoStringWritesRetired: true,
    scheduler: {
      repository: {} as never,
      wake: {} as never,
      projects: {} as never,
    },
  }).build();
}

describe("given connection routing decides sign-ins on this installation", () => {
  describe("when an operator edits the organization's older single sign-on fields", () => {
    /** @scenario "The old single sign-on fields stop being where single sign-on is set up" */
    it("refuses the edit with sso_connection_string_edit_retired and points at the connection", async () => {
      const ops = backoffice();

      const refusal = await ops
        .adminOperation(organizationEdit({ ssoDomain: "acme.com", ssoProvider: "okta" }))
        .then(
          () => null,
          (error: unknown) => readHandledError(error),
        );

      expect(refusal?.code).toBe("sso_connection_string_edit_retired");

      // The words a reader sees come from the registry keyed by the code, never
      // from the error's own message -- which on the wire IS the code.
      const copy = explainHandledError(refusal!);
      expect(copy.isRegistered).toBe(true);
      expect(copy.description).toMatch(/connection/i);
      expect(copy.description).not.toMatch(/sso_connection_string_edit/);
    });
  });
});

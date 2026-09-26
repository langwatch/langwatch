import { createApiFixture } from "@langwatch/api-fixture";
/**
 * The backoffice's organization edit, with the routing flip on. The
 * refusal is raised in the ops service graph, and its copy is read from
 * the presentation registry. Spec: specs/identity/sso-onboarding-tiers.feature
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AutomationApi } from "@langwatch/automation-contract";
import { explainHandledError } from "@langwatch/error-presentation/presentation";
import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { OpsOperations } from "../../app/ops-composition.build.ts";
import type { OpsEventExplorer, OpsProcessExplorer, OpsReplayRunner } from "../../app/ops.app.ts";
import { AuditStub, organizationEdit } from "./support/backoffice-doubles.ts";
import { TestUserApi } from "./support/test-user-api.ts";

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

function backoffice(connectionDecides = true) {
  return OpsOperations.create({
    database: refuseEveryQuery as never,
    audit: new AuditStub(),
    auditLog: createApiFixture<AuditLogApi>(),
    adminEmails: ["olive@example.com"],
    users: new TestUserApi(),
    auth: createApiFixture<AuthApi>(),
    ssoRouting: { connectionDecides: async () => connectionDecides },
    scheduler: {
      schedules: createApiFixture<AutomationApi>(),
      projects: createApiFixture<ProjectApi>(),
    },
    explorers: {
      eventExplorer: createApiFixture<OpsEventExplorer>(),
      managerExplorer: createApiFixture<OpsProcessExplorer>(),
      replay: createApiFixture<OpsReplayRunner>(),
      snapshots: null,
    },
  }).build();
}

describe("given an organization whose own connection decides its sign-in", () => {
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

describe("given an organization that has no connection at all", () => {
  describe("when an operator edits its older single sign-on fields", () => {
    /** @scenario "Which routing decides is asked per organization, never set fleet-wide" */
    it("accepts the edit, because that organization's strings still decide", async () => {
      const ops = backoffice(false);

      const refusal = await ops
        .adminOperation(organizationEdit({ ssoDomain: "globex.com", ssoProvider: "okta" }))
        .then(
          () => null,
          (error: unknown) => readHandledError(error),
        );

      // The database stub refuses every query, so reaching it at all is the
      // proof: the edit was not turned away before it got there.
      expect(refusal?.code).not.toBe("sso_connection_string_edit_retired");
    });
  });
});

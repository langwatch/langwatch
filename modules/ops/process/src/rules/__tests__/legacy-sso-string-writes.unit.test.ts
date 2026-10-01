import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthApi } from "@langwatch/auth-contract";
import { describe, expect, it } from "vitest";

import {
  AuditStub,
  organizationEdit,
  RepositoryStub,
} from "../../services/__tests__/support/backoffice-doubles.ts";
import { TestUserApi } from "../../services/__tests__/support/test-user-api.ts";
import { AdminBackofficeService } from "../../services/admin-backoffice.service.ts";
import {
  legacySsoStringColumnsIn,
  legacySsoStringWritesToRefuse,
} from "../legacy-sso-string-writes.rules.ts";

function backoffice(connectionDecides: boolean) {
  const repository = new RepositoryStub();
  const service = AdminBackofficeService.create({
    repository,
    users: new TestUserApi(),
    auth: createApiFixture<AuthApi>(),
    audit: new AuditStub(),
    ssoRouting: { connectionDecides: async () => connectionDecides },
  });
  return { repository, service };
}

describe("the legacy single sign-on string columns", () => {
  describe("given an organization whose legacy strings still decide its sign-in", () => {
    describe("when a staff member edits the string columns", () => {
      /** @scenario "Which routing decides is asked per organization, never set fleet-wide" */
      it("keeps accepting the edit, because the strings still decide sign-in", async () => {
        const { repository, service } = backoffice(false);

        await service.execute(organizationEdit({ ssoDomain: " ACME.com ", ssoProvider: "okta" }));

        expect(repository.execute).toHaveBeenCalledTimes(1);
        expect(repository.execute.mock.calls[0]?.[0].params.data).toMatchObject({
          ssoDomain: "acme.com",
          ssoProvider: "okta",
        });
      });
    });
  });

  describe("given an organization whose own connection decides its sign-in", () => {
    describe("when a staff member edits the string columns", () => {
      /** @scenario "Once a connection decides, the strings stop being written" */
      it("refuses the edit and writes nothing", async () => {
        const { repository, service } = backoffice(true);

        await expect(
          service.execute(organizationEdit({ name: "Acme", ssoDomain: "acme.com" })),
        ).rejects.toMatchObject({ code: "sso_connection_string_edit_retired" });

        expect(repository.execute).not.toHaveBeenCalled();
      });

      /** @scenario "Once a connection decides, the strings stop being written" */
      it("names the columns that are derived now", () => {
        expect(legacySsoStringColumnsIn({ ssoDomain: "acme.com", ssoProvider: "okta" })).toEqual([
          "ssoDomain",
          "ssoProvider",
        ]);
      });
    });

    describe("when the edit names no string column", () => {
      /** @scenario "Once a connection decides, the strings stop being written" */
      it("leaves every other organization edit alone", async () => {
        const { repository, service } = backoffice(true);

        await service.execute(organizationEdit({ name: "Acme" }));

        expect(repository.execute).toHaveBeenCalledTimes(1);
        expect(legacySsoStringWritesToRefuse({ data: undefined, connectionDecides: true })).toEqual(
          [],
        );
      });
    });
  });
});

import { describe, expect, it } from "vitest";
import { AdminBackofficeService } from "../../services/admin-backoffice.service.ts";
import {
  AuditStub,
  AuthStub,
  organizationEdit,
  RepositoryStub,
  UsersStub,
} from "../../services/__tests__/support/backoffice-doubles.ts";
import {
  legacySsoStringColumnsIn,
  legacySsoStringWritesToRefuse,
} from "../legacy-sso-string-writes.rules.ts";

function backoffice(retired: boolean) {
  const repository = new RepositoryStub();
  const service = AdminBackofficeService.create({
    repository,
    users: new UsersStub(),
    auth: new AuthStub(),
    audit: new AuditStub(),
    legacySsoStringWritesRetired: retired,
  });
  return { repository, service };
}

describe("the legacy single sign-on string columns", () => {
  describe("given the connection routing flag is off or in shadow", () => {
    describe("when a staff member edits the string columns", () => {
      /** @scenario "After the flip, the strings stop being written" */
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

  describe("given the connection routing flag is enforced", () => {
    describe("when a staff member edits the string columns", () => {
      /** @scenario "After the flip, the strings stop being written" */
      it("refuses the edit and writes nothing", async () => {
        const { repository, service } = backoffice(true);

        await expect(
          service.execute(organizationEdit({ name: "Acme", ssoDomain: "acme.com" })),
        ).rejects.toMatchObject({ code: "sso_connection_string_edit_retired" });

        expect(repository.execute).not.toHaveBeenCalled();
      });

      /** @scenario "After the flip, the strings stop being written" */
      it("names the columns that are derived now", () => {
        expect(legacySsoStringColumnsIn({ ssoDomain: "acme.com", ssoProvider: "okta" })).toEqual([
          "ssoDomain",
          "ssoProvider",
        ]);
      });
    });

    describe("when the edit names no string column", () => {
      /** @scenario "After the flip, the strings stop being written" */
      it("leaves every other organization edit alone", async () => {
        const { repository, service } = backoffice(true);

        await service.execute(organizationEdit({ name: "Acme" }));

        expect(repository.execute).toHaveBeenCalledTimes(1);
        expect(legacySsoStringWritesToRefuse({ data: undefined, retired: true })).toEqual([]);
      });
    });
  });
});

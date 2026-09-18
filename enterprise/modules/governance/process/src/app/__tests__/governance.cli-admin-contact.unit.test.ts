// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What `cliContacts` answers with. The module already owns the rows behind
 * "contact your admin", so the port reads them — the admin-configured contact
 * first, then the oldest admin membership that still resolves to an address —
 * rather than paging a member listing and taking whoever came back first.
 */
import { describe, expect, it } from "vitest";

import { OrganizationSupportContactRepository } from "../../repositories/organization-support-contact.repository.ts";
import { OrganizationSupportContactService } from "../../services/organization-support-contact.service.ts";
import type { CliAdminContactReader } from "../governance.members.ts";

/** One organization's admin memberships, their addresses, and its override. */
class StubSupportContacts extends OrganizationSupportContactRepository {
  constructor(
    private readonly admins: readonly string[],
    private readonly emails: ReadonlyMap<string, string | null>,
    private readonly configured: string | null,
  ) {
    super();
  }

  async findAdminUserIds(): Promise<string[]> {
    return [...this.admins];
  }

  async findEmailsByUserIds({
    userIds,
  }: {
    userIds: string[];
  }): Promise<Map<string, string | null>> {
    return new Map(
      userIds
        .filter((userId) => this.emails.has(userId))
        .map((userId) => [userId, this.emails.get(userId) ?? null]),
    );
  }

  async findConfiguredSupportContact(): Promise<string | null> {
    return this.configured;
  }
}

/**
 * The port's one operation, spelled out rather than indexed off
 * `CliAdminContactReader`: every same-package import here resolves through an
 * unbuilt `dist/*.d.ts` (TS6305) and degrades to `any`, so an indexed type
 * would type nothing. The return annotation still binds the wiring to the port.
 */
type FindAdminEmail = (organizationId: string) => Promise<string | null>;

/** Exactly the wiring the App performs for `cliContacts`, typed against the port. */
function cliContactsOver(repository: OrganizationSupportContactRepository): CliAdminContactReader {
  const supportContacts = OrganizationSupportContactService.create({ repository });
  const findAdminEmail: FindAdminEmail = (organizationId) =>
    supportContacts.findSupportContact({ organizationId });

  return { findAdminEmail };
}

describe("given an organization that configured its own support contact", () => {
  describe("when the CLI asks who to point a refused caller at", () => {
    it("answers the configured contact, which need not be an address", async () => {
      const contacts = cliContactsOver(
        new StubSupportContacts(
          ["user_1"],
          new Map([["user_1", "admin@example.com"]]),
          "https://acme.example/help",
        ),
      );

      await expect(contacts.findAdminEmail("organization")).resolves.toBe(
        "https://acme.example/help",
      );
    });
  });
});

describe("given an organization that configured no support contact", () => {
  describe("when the CLI asks who to point a refused caller at", () => {
    it("answers the oldest admin membership's address", async () => {
      const contacts = cliContactsOver(
        new StubSupportContacts(
          ["user_1", "user_2"],
          new Map([
            ["user_1", "first@example.com"],
            ["user_2", "second@example.com"],
          ]),
          null,
        ),
      );

      await expect(contacts.findAdminEmail("organization")).resolves.toBe("first@example.com");
    });

    it("skips an admin whose user row no longer exists", async () => {
      const contacts = cliContactsOver(
        new StubSupportContacts(
          ["orphan", "user_2"],
          new Map([["user_2", "second@example.com"]]),
          null,
        ),
      );

      await expect(contacts.findAdminEmail("organization")).resolves.toBe("second@example.com");
    });

    it("answers nothing when the organization has no admin at all", async () => {
      const contacts = cliContactsOver(new StubSupportContacts([], new Map(), null));

      await expect(contacts.findAdminEmail("organization")).resolves.toBeNull();
    });
  });
});

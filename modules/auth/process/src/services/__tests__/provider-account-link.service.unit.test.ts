import { describe, expect, it } from "vitest";

import {
  ProviderAccountLinkService,
  type ProviderAccountRow,
  type ProviderAccountWriter,
} from "../provider-account-link.service.ts";

/** Better Auth's account write, kept as the rows it was handed. */
class RecordedAccounts implements ProviderAccountWriter {
  readonly rows: ProviderAccountRow[] = [];

  async createAccount(row: ProviderAccountRow): Promise<void> {
    this.rows.push(row);
  }
}

function linker(connectionIssuers: Record<string, string> = {}) {
  const accounts = new RecordedAccounts();
  const service = ProviderAccountLinkService.create({
    issuers: {
      findIssuersForConnection: async ({ connectionId }) => {
        const issuer = connectionIssuers[connectionId];
        return issuer ? [issuer] : [];
      },
    },
    accounts,
  });
  return { service, accounts };
}

const proposal = {
  userId: "user_1",
  subject: "subject-123",
};

describe("given a confirmed link proposal", () => {
  describe("when it names a connection with a registered issuer", () => {
    it("keys the account by that connection's issuer", async () => {
      const { service, accounts } = linker({ conn_1: "https://idp.acme.test" });

      await service.link({ ...proposal, connectionId: "conn_1", provider: "sso" });

      expect(accounts.rows).toEqual([
        {
          userId: "user_1",
          providerId: "sso",
          issuer: "https://idp.acme.test",
          accountId: "subject-123",
        },
      ]);
    });
  });

  describe("when its connection has no issuer on record", () => {
    it("falls back to the provider's own issuer", async () => {
      const { service, accounts } = linker();

      await service.link({ ...proposal, connectionId: "conn_gone", provider: "okta" });

      expect(accounts.rows[0]?.issuer).toBe("local:oauth:okta");
    });
  });

  describe("when it names no connection", () => {
    it("keys google by the issuer Google declares", async () => {
      const { service, accounts } = linker();

      await service.link({ ...proposal, connectionId: null, provider: "google" });

      expect(accounts.rows[0]?.issuer).toBe("https://accounts.google.com");
    });

    it("keys a password account by the local credential issuer", async () => {
      const { service, accounts } = linker();

      await service.link({ ...proposal, connectionId: null, provider: "credential" });

      expect(accounts.rows[0]?.issuer).toBe("local:credential");
    });

    it("keys any other provider by the synthetic namespace, escaped", async () => {
      const { service, accounts } = linker();

      await service.link({ ...proposal, connectionId: null, provider: "git hub" });

      expect(accounts.rows[0]?.issuer).toBe("local:oauth:git%20hub");
    });
  });
});

/**
 * The read a peer is answered from when it owns no `Account` row: which
 * providers let this person in, and none of the rows behind them.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it } from "vitest";

import type { BetterAuthHooksRepository } from "../../repositories/better-auth-hooks.repository.ts";
import { FederatedAccountReadsService } from "../federated-account-reads.service.ts";

const serviceOver = (rows: { providerId: string; accountId: string }[]) =>
  FederatedAccountReadsService.create({
    accounts: createApiFixture<BetterAuthHooksRepository>({
      findFederatedAccountsForUser: async () => rows,
    }),
  });

describe("given somebody holding accounts through two providers", () => {
  it("names each provider once, whatever the row count", async () => {
    const service = serviceOver([
      { providerId: "google", accountId: "sub-1" },
      { providerId: "local_ssoc_one", accountId: "sub-2" },
      { providerId: "google", accountId: "sub-3" },
    ]);

    await expect(service.findProvidersForUser({ userId: "user_ana" })).resolves.toEqual([
      "google",
      "local_ssoc_one",
    ]);
  });
});

describe("given somebody holding no federated account", () => {
  it("answers with an empty list rather than nothing", async () => {
    await expect(serviceOver([]).findProvidersForUser({ userId: "user_ana" })).resolves.toEqual([]);
  });
});

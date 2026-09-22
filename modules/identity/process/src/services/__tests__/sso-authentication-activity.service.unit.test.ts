/**
 * @vitest-environment node
 * What a sign-in through a connection leaves behind: the trail activation
 * reads for its test sign-in, and the quiet period is measured from.
 * Corresponds to specs/identity/sso-activation.feature.
 */
import { emptySsoConnection, type SsoConnectionState } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { MemoryIdentityStore } from "../../repositories/memory/memory-identity.store.ts";
import { MemorySsoMigrationEvidenceRepository } from "../../repositories/memory/memory.sso-migration-evidence.repository.ts";
import { SsoConnectionReadRepository } from "../../repositories/sso-connection.repository.ts";
import { SsoAuthenticationActivityService } from "../sso-authentication-activity.service.ts";

const ACME = "org_acme";
const CONNECTION = "ssoc_acme";

class StubConnectionReads extends SsoConnectionReadRepository {
  constructor(private readonly known: SsoConnectionState | null) {
    super();
  }
  async tryFindConnection({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<SsoConnectionState | null> {
    return this.known?.connectionId === connectionId ? this.known : null;
  }
  async tryFindDomainOwner(): Promise<null> {
    return null;
  }
  async findForOrganization(): Promise<SsoConnectionState[]> {
    return [];
  }
}

function serviceOver(known: SsoConnectionState | null) {
  const store = MemoryIdentityStore.create();
  const activity = MemorySsoMigrationEvidenceRepository.create(store);
  return {
    store,
    activity,
    service: SsoAuthenticationActivityService.create({
      connections: new StubConnectionReads(known),
      activity,
      now: () => 1_700_000_000_000,
    }),
  };
}

const ACME_CONNECTION: SsoConnectionState = {
  ...emptySsoConnection({ connectionId: CONNECTION }),
  organizationId: ACME,
};

describe("recording a sign-in that came through a single sign-on connection", () => {
  it("writes it against the organization the connection belongs to", async () => {
    const { store, service } = serviceOver(ACME_CONNECTION);

    await service.record({ connectionId: CONNECTION, userId: "user_1" });

    expect(store.ssoAuthentications).toEqual([
      {
        organizationId: ACME,
        connectionId: CONNECTION,
        userId: "user_1",
        authenticatedAtMs: 1_700_000_000_000,
      },
    ]);
  });

  it("records nothing for a provider that names no connection", async () => {
    const { store, service } = serviceOver(ACME_CONNECTION);

    await service.record({ connectionId: "google", userId: "user_1" });

    expect(store.ssoAuthentications).toEqual([]);
  });

  it("keeps the sign-in when the trail cannot be written", async () => {
    const { activity, service } = serviceOver(ACME_CONNECTION);
    activity.recordAuthentication = async () => {
      throw new Error("the store is down");
    };

    await expect(
      service.record({ connectionId: CONNECTION, userId: "user_1" }),
    ).resolves.toBeUndefined();
  });
});

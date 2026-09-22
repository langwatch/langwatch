/**
 * @vitest-environment node
 * Going live reads the test sign-in off the connection's own trail: the
 * account is evidence the journey holds, never a value a caller supplies.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { emptySsoConnection, type SsoConnectionState } from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryIdentityStore } from "../../repositories/memory/memory-identity.store.ts";
import { MemoryIdentityRepositories } from "../../repositories/memory/memory.identity.repositories.ts";
import { SsoConnectionReadRepository } from "../../repositories/sso-connection.repository.ts";
import type { SsoCredentialRepository } from "../../repositories/sso-credential.repository.ts";
import type { SsoConnectionService } from "../sso-connection.service.ts";
import type { SsoIdpRegistrationService } from "../sso-idp-registration.service.ts";
import type { SsoMigrationFinalizationService } from "../sso-migration-finalization.service.ts";
import { SsoSetupCommandsService } from "../sso-setup-commands.service.ts";

const ORGANIZATION_ID = "org_acme";
const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const ACTOR = { userId: "user_ana" };

const connection = (over: Partial<SsoConnectionState> = {}): SsoConnectionState => ({
  ...emptySsoConnection({ connectionId: CONNECTION_ID }),
  organizationId: ORGANIZATION_ID,
  state: "VERIFIED",
  ...over,
});

class OneConnection extends SsoConnectionReadRepository {
  constructor(private readonly row: SsoConnectionState) {
    super();
  }

  async tryFindConnection(): Promise<SsoConnectionState | null> {
    return this.row;
  }

  async tryFindDomainOwner(): Promise<null> {
    return null;
  }

  async findForOrganization(): Promise<SsoConnectionState[]> {
    return [this.row];
  }
}

function serviceOver({
  row = connection(),
  signIns = [] as { userId: string; providerAccountId: string | null; atMs: number }[],
} = {}) {
  const store = MemoryIdentityStore.create();
  for (const signIn of signIns) {
    store.ssoAuthentications.push({
      organizationId: ORGANIZATION_ID,
      connectionId: CONNECTION_ID,
      userId: signIn.userId,
      authenticatedAtMs: signIn.atMs,
      providerAccountId: signIn.providerAccountId,
    });
  }
  const activateConnection = vi.fn(async () => []);
  const service = SsoSetupCommandsService.create({
    connections: () => createApiFixture<SsoConnectionService>({ activateConnection }),
    reads: new OneConnection(row),
    activity: MemoryIdentityRepositories.over(store).ssoMigrationEvidence,
    credentials: createApiFixture<SsoCredentialRepository>({}),
    registrations: createApiFixture<SsoIdpRegistrationService>({}),
    finalization: createApiFixture<SsoMigrationFinalizationService>({}),
    now: () => 1_700_000_000_000,
  });
  return { service, activateConnection };
}

const activate = (service: SsoSetupCommandsService) =>
  service.activate({ organizationId: ORGANIZATION_ID, connectionId: CONNECTION_ID, actor: ACTOR });

describe("taking a connection live", () => {
  it("names the subject the newest recorded sign-in asserted", async () => {
    const { service, activateConnection } = serviceOver({
      signIns: [
        { userId: "user_ana", providerAccountId: "okta|ana", atMs: 1_699_000_000_000 },
        { userId: "user_ana", providerAccountId: "okta|ana-newer", atMs: 1_699_500_000_000 },
      ],
    });

    await activate(service);

    expect(activateConnection).toHaveBeenCalledWith(
      expect.objectContaining({ testLoginAccountId: "okta|ana-newer" }),
    );
  });

  it("refuses a connection nobody has signed in through", async () => {
    const { service, activateConnection } = serviceOver();

    await expect(activate(service)).rejects.toMatchObject({
      code: "sso_connection_activation_blocked",
    });
    expect(activateConnection).not.toHaveBeenCalled();
  });

  it("refuses when every recorded sign-in named no subject", async () => {
    const { service } = serviceOver({
      signIns: [{ userId: "user_ana", providerAccountId: null, atMs: 1_699_000_000_000 }],
    });

    await expect(activate(service)).rejects.toMatchObject({
      code: "sso_connection_activation_blocked",
    });
  });

  it("keeps the account a completed activation already recorded", async () => {
    const { service, activateConnection } = serviceOver({
      row: connection({ state: "ACTIVE", testLoginAccountId: "okta|ana" }),
    });

    await activate(service);

    expect(activateConnection).toHaveBeenCalledWith(
      expect.objectContaining({ testLoginAccountId: "okta|ana" }),
    );
  });
});

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * When a move to the organization's own identity provider finishes, the
 * directory sync of the connection it replaced moves across with it.
 */
import { describe, expect, it } from "vitest";

import type { ScimSyncLifecycle } from "../../app/scim.members.ts";
import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import type { ScimDirectoryIdentityRecord } from "../../repositories/scim.repository.ts";
import { ScimDirectoryMoveService } from "../scim-directory-move.service.ts";

const ORGANIZATION_ID = "org_acme";
const LEGACY = "ssoc_legacy";
const REPLACEMENT = "ssoc_direct";

function setup() {
  const directory = MemoryScimRepository.create();
  const history: string[] = [];
  const lifecycle: Pick<ScimSyncLifecycle, "tokenIssued" | "revoked"> = {
    tokenIssued: async ({ connectionId, tokenId }: { connectionId: string; tokenId: string }) => {
      history.push(`issued ${connectionId} ${tokenId}`);
    },
    revoked: async ({
      connectionId,
      tokenId,
    }: {
      connectionId: string;
      tokenId: string | null;
    }) => {
      history.push(`revoked ${connectionId} ${tokenId}`);
    },
  };
  const service = ScimDirectoryMoveService.create({ directory, lifecycle });
  const finish = () =>
    service.moveToConnection({
      organizationId: ORGANIZATION_ID,
      fromConnectionId: LEGACY,
      toConnectionId: REPLACEMENT,
    });
  return { directory, history, finish };
}

async function seed(directory: MemoryScimRepository) {
  const { id } = await directory.createToken({
    organizationId: ORGANIZATION_ID,
    connectionId: LEGACY,
    hashedToken: "hash-1",
    hashScheme: "hmac-sha256",
    description: null,
  });
  await directory.rememberDirectoryIdentity({
    connectionId: LEGACY,
    externalId: "ext-ana",
    userId: "user_ana",
  });
  await directory.rememberDirectoryIdentity({
    connectionId: LEGACY,
    externalId: "ext-bo",
    userId: "user_bo_old",
  });
  await directory.rememberDirectoryIdentity({
    connectionId: REPLACEMENT,
    externalId: "ext-bo",
    userId: "user_bo",
  });
  return id;
}

describe("when an update finishes and the previous connection's sync moves across", () => {
  /** @scenario "Finishing a move to the organization's own identity provider moves its directory sync across" */
  it("re-homes the tokens and the identities they provisioned, and starts the replacement's sync history", async () => {
    const { directory, history, finish } = setup();
    const tokenId = await seed(directory);

    await finish();

    await expect(directory.findTokensByHashes(["hash-1"])).resolves.toMatchObject([
      { connectionId: REPLACEMENT },
    ]);
    await expect(
      directory.findDirectoryUserId({ connectionId: REPLACEMENT, externalId: "ext-ana" }),
    ).resolves.toBe("user_ana");
    await expect(
      directory.findDirectoryUserId({ connectionId: REPLACEMENT, externalId: "ext-bo" }),
    ).resolves.toBe("user_bo");
    expect(
      directory.directoryIdentities.filter(
        (row: ScimDirectoryIdentityRecord) => row.connectionId === LEGACY,
      ),
    ).toEqual([]);
    expect(history).toEqual([`issued ${REPLACEMENT} ${tokenId}`, `revoked ${LEGACY} null`]);
  });

  /** @scenario "A directory move delivered again moves nothing more" */
  it("moves nothing more when the event is delivered again", async () => {
    const { directory, history, finish } = setup();
    await seed(directory);

    await finish();
    const identities = [...directory.directoryIdentities];
    await finish();

    expect(directory.directoryIdentities).toEqual(identities);
    expect(history.filter((line) => line.startsWith("issued"))).toHaveLength(1);
  });
});

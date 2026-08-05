/**
 * Shared Azurite testcontainer bootstrap for the AC37 (issue #4133)
 * integration suites — stored-objects media round-trip, dataset round-trip,
 * and the postgres->azure backfill migration all need the same real Azure
 * Blob emulator, so the boot/teardown + well-known credentials + container
 * bootstrap live here once instead of copy-pasted three times.
 *
 * Not a `*.test.ts` file, so vitest's integration glob does not pick it up
 * as a suite on its own.
 */
import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from "testcontainers";
import { AzureBlobDriver } from "../azure-blob-driver";

/**
 * Azurite's fixed well-known development credentials — the SAME values
 * Microsoft's own emulator docs publish (not a secret; every Azurite
 * instance accepts exactly this account/key pair by default).
 */
export const AZURITE_ACCOUNT_NAME = "devstoreaccount1";
export const AZURITE_ACCOUNT_KEY =
  "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==";

const AZURITE_BLOB_PORT = 10000;

export type StartedAzurite = {
  container: StartedTestContainer;
  endpointBaseUrl: string;
  accountName: string;
  accountKey: string;
};

/**
 * Starts an Azurite emulator container and returns its path-style endpoint
 * (Azurite's only addressing mode — it has no per-account subdomain the way
 * production Azure does), matching the AC37 scenario's "the Azurite emulator
 * uses path-style addressing" precondition.
 */
export async function startAzurite(): Promise<StartedAzurite> {
  const container = await new GenericContainer(
    // Pinned deliberately: these suites assert on SharedKey signing behaviour,
    // so a floating tag would let an emulator update turn a green suite red (or
    // worse, hide a regression) with no commit to blame.
    "mcr.microsoft.com/azure-storage/azurite:3.36.0",
  )
    .withExposedPorts(AZURITE_BLOB_PORT)
    // Without a wait strategy, .start() resolves when the container is
    // created, not when azurite-blob is accepting connections — the first
    // request then races the emulator's boot and fails intermittently in CI.
    .withWaitStrategy(Wait.forListeningPorts())
    .withCommand([
      "azurite-blob",
      "--blobHost",
      "0.0.0.0",
      "--blobPort",
      String(AZURITE_BLOB_PORT),
    ])
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(AZURITE_BLOB_PORT);
  const endpointBaseUrl = `http://${host}:${port}/${AZURITE_ACCOUNT_NAME}`;

  return {
    container,
    endpointBaseUrl,
    accountName: AZURITE_ACCOUNT_NAME,
    accountKey: AZURITE_ACCOUNT_KEY,
  };
}

export async function stopAzurite(
  azurite: StartedAzurite | undefined,
): Promise<void> {
  // Guard: beforeAll may have failed before startAzurite resolved, in which
  // case afterAll still runs with an undefined handle.
  await azurite?.container.stop();
}

/** Idempotently creates a container in the running Azurite instance. */
export async function ensureAzuriteContainer({
  azurite,
  container,
}: {
  azurite: StartedAzurite;
  container: string;
}): Promise<void> {
  const driver = new AzureBlobDriver({
    accountName: azurite.accountName,
    accountKey: azurite.accountKey,
    endpointBaseUrl: azurite.endpointBaseUrl,
  });
  await driver.ensureContainer(container);
}

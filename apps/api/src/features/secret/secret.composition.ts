/**
 * The project's stored credentials, installed over this process's own graph.
 * The cipher is the PROCESS's: a deployment given no key composes no secret
 * feature at all, which is why the root calls this only when it holds one.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApp } from "@langwatch/runtime-composition";
import { secretServer, type SecretEncryptionPort } from "@langwatch/secret-server";

import type { ComposedSecretFeature } from "./secret.composition.types.ts";
import { createSecretTrpcRouter } from "./secret-trpc.mount.ts";

/** Installs the secret surfaces over this process's own graph. */
export async function installApiSecret(options: {
  /** The one guarded connection every row read runs on. */
  prisma: PrismaClient;
  /** The stored-secret cipher this process composed from its configured key. */
  encryption: SecretEncryptionPort;
}): Promise<ComposedSecretFeature> {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: options.prisma })
    .withInfrastructure({})
    .withModule(secretServer, { infrastructure: { encryption: options.encryption } })
    .boot({ role: "api" });

  const app = runtime.module(secretServer).provided;

  return {
    routers: (mount) => ({ secrets: createSecretTrpcRouter(mount.runtime) }),
    app,
  };
}

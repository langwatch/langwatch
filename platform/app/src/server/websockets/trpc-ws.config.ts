import { Config, RuntimeConfig } from "@langwatch/config";
import { z } from "zod";

const trpcWebSocketConfigDefinition = RuntimeConfig.define({
  publicUrl: Config.value(z.string().optional(), { env: "NEXTAUTH_URL" }),
});

export type TrpcWebSocketRuntimeConfig = Readonly<{
  allowedOrigins: readonly string[];
}>;

/**
 * Resolves the small, non-secret WebSocket transport policy from executable
 * configuration. Invalid or absent public URLs deliberately produce no
 * allowed origins, which keeps cookie-authenticated upgrades fail-closed.
 */
export function resolveTrpcWebSocketRuntimeConfig(input: {
  NEXTAUTH_URL?: unknown;
}): TrpcWebSocketRuntimeConfig {
  const values = RuntimeConfig.create({
    name: "tRPC WebSocket transport",
    definition: trpcWebSocketConfigDefinition,
    source: input,
  }).value;

  if (!values.publicUrl) {
    return { allowedOrigins: [] };
  }

  try {
    return { allowedOrigins: [new URL(values.publicUrl).origin] };
  } catch {
    return { allowedOrigins: [] };
  }
}

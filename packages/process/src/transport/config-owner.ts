import { fileURLToPath } from "node:url";

import { Config, ConfigParseError, type ProcessConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets";
import { z } from "zod";

/** The previous release refused an instance admin key under 32 characters; blank is absent. */
const instanceAdminKey = {
  parse(value: string): string {
    if (value.length >= 32) return value;
    throw new ConfigParseError([
      "http.instanceAdmin ← LANGWATCH_INSTANCE_ADMIN_API_KEY: must be at least 32 characters",
    ]);
  },
};

export const apiOwner = {
  name: "http",
  config: Config.define((c) => ({
    trustedProxies: c.env(
      "TRUSTED_PROXY_ADDRESSES",
      z
        .string()
        .optional()
        .transform((value) => {
          if (value === undefined) return void 0;
          return value
            .split(",")
            .map((address) => address.trim())
            .filter(Boolean);
        }),
    ),
    bundleDirectory: c.env(
      "LANGWATCH_UI_DIST_DIR",
      z
        .string()
        .default(fileURLToPath(new URL("../../../../apps/ui/dist/client", import.meta.url))),
    ),
    assetBase: c.env("LANGWATCH_ASSET_BASE", z.string().optional()),
  })),
  secrets: {
    instanceAdmin: Secret.load("LANGWATCH_INSTANCE_ADMIN_API_KEY", {
      optional: true,
      schema: instanceAdminKey,
    }),
  },
} as const;
export type ApiHostConfig = ProcessConfigOf<readonly [typeof apiOwner]>["http"];

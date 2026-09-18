import { fileURLToPath } from "node:url";

import { Config, type ProcessConfigOf } from "@langwatch/config";
import { Secret } from "@langwatch/secrets";
import { z } from "zod";

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
    cron: Secret.load("CRON_API_KEY", { optional: true }),
    instanceAdmin: Secret.load("LANGWATCH_INSTANCE_ADMIN_API_KEY", { optional: true }),
  },
} as const;
export type ApiHostConfig = ProcessConfigOf<readonly [typeof apiOwner]>["http"];

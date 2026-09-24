/**
 * Deployment facts several owners read (ARCHITECTURE.md §6, layer 3). Each is
 * ONE leaf, imported by instance: the parse admits a re-bound variable only
 * when every claimant holds that same leaf.
 */
import { z } from "zod";

import { Config } from "./config.ts";

const positiveInteger = z.coerce.number().int().positive();

export const { langevalsStagingThresholdBytes, langevalsStagingTtlSeconds } = Config.define(
  (c) => ({
    /** Unset keeps every payload inline: only a Lambda-fronted langevals has a body cap. */
    langevalsStagingThresholdBytes: c.env(
      "LANGEVALS_STAGING_THRESHOLD_BYTES",
      positiveInteger.optional(),
    ),
    /** How long a staged payload's signed URL stays valid; short, so a leaked URL lapses. */
    langevalsStagingTtlSeconds: c.env(
      "LANGEVALS_STAGING_TTL_SECONDS",
      positiveInteger.default(600),
    ),
  }),
);

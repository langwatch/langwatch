import { Config, type ConfigOf } from "@langwatch/config";
import { z } from "zod";

/**
 * Redaction pipeline config: DLP engines and enforcement switch.
 * `googleApplicationCredentials` resolves through the process's declared
 * secrets (ADR-132), never this slice — see `DataPrivacyApp.secrets`.
 */
export const dataPrivacyConfig = Config.define((c) => ({
  googleDlpDisabled: c.env(
    "LANGWATCH_DISABLE_GOOGLE_DLP",
    z.union([z.boolean(), z.string()]).optional(),
  ),
  /** Anything but the literal `off` enforces the native policy. */
  enforcement: c.env("LANGWATCH_DATA_PRIVACY_ENFORCEMENT", z.string().optional()),
}));

export type DataPrivacyServerConfig = ConfigOf<typeof dataPrivacyConfig>;

/**
 * How long a redaction call may take. Not configurable: the ceiling belongs
 * to the pipeline's own budget, and no deployment has ever set it.
 */
export const DATA_PRIVACY_PRESIDIO_TIMEOUT_MS = 60_000;

/**
 * How many signatures each key passed and failed, per hour. Shared by every pod, so the keys
 * screen counts every server's spans; an hour's counts expire after `SIGNING_KEY_USAGE_TTL_MS`.
 */

/** Long enough that the 24 hours the screen counts are always held. */
export const SIGNING_KEY_USAGE_TTL_MS = 25 * 60 * 60 * 1000;

/** One key's counts in one hour, the hour as `signingKeyUsageHourOf` gives it. */
export type SigningKeyHourlyUsage = Readonly<{
  keyId: string;
  hour: number;
  passed: number;
  failed: number;
}>;

export interface SigningKeyUsageRepository {
  add(input: { usage: readonly SigningKeyHourlyUsage[] }): Promise<void>;
  /** One entry per key asked, summed over `[fromHour, toHour]`, zero where nothing was counted. */
  findTotals(input: {
    keyIds: readonly string[];
    fromHour: number;
    toHour: number;
  }): Promise<{ keyId: string; passed: number; failed: number }[]>;
}

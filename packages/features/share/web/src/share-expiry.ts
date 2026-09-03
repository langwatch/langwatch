/** The expiry choices the share dialog offers, in the order it offers them. */
export const SHARE_EXPIRY_OPTIONS = ["never", "1h", "24h", "7d", "30d"] as const;

export type ShareExpiryOption = (typeof SHARE_EXPIRY_OPTIONS)[number];

const EXPIRY_MS: Record<Exclude<ShareExpiryOption, "never">, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export function isShareExpiryOption(value: unknown): value is ShareExpiryOption {
  return SHARE_EXPIRY_OPTIONS.some((option) => option === value);
}

/** `never` is the absence of an expiry, which the contract spells `null`. */
export function expiryToDate({
  option,
  now = new Date(),
}: {
  option: ShareExpiryOption;
  now?: Date;
}): Date | null {
  if (option === "never") {
    return null;
  }

  return new Date(now.getTime() + EXPIRY_MS[option]);
}

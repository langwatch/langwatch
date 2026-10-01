/** One model-provider row as the project lists it; only the fields read here matter. */
export type ProviderRowReading = Readonly<Record<string, unknown>>;

function keysOf(row: ProviderRowReading): Readonly<Record<string, unknown>> {
  const keys = row.customKeys;
  if (typeof keys !== "object" || keys === null) return {};
  return Object.fromEntries(Object.entries(keys));
}

/** Whether an enabled ElevenLabs row carries a key (or the system key). */
export function hasElevenLabsKeyIn(rows: readonly ProviderRowReading[]): boolean {
  return rows.some(
    (row) =>
      row.provider === "elevenlabs" &&
      row.enabled === true &&
      (row.isSystem === true || Boolean(keysOf(row).ELEVENLABS_API_KEY)),
  );
}

/**
 * Whether an enabled Twilio row carries all three keys a call needs. A system
 * row alone does not count: the server never fills its customKeys.
 */
export function hasTwilioKeyIn(rows: readonly ProviderRowReading[]): boolean {
  return rows.some((row) => {
    if (row.provider !== "twilio" || row.enabled !== true) return false;
    const keys = keysOf(row);
    return (
      Boolean(keys.TWILIO_ACCOUNT_SID) &&
      Boolean(keys.TWILIO_AUTH_TOKEN) &&
      Boolean(keys.TWILIO_FROM_NUMBER)
    );
  });
}

/** The payload as a peer takes it: a key whose value is absent is left out. */
export function definedGuidedPayload(
  payload: Readonly<Record<string, string | string[] | number | undefined>>,
): Record<string, string | string[] | number> {
  return Object.fromEntries(
    Object.entries(payload).filter(
      (entry): entry is [string, string | string[] | number] => entry[1] !== undefined,
    ),
  );
}

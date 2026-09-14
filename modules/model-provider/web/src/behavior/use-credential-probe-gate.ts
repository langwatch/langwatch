import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Decides whether a credential still has to be probed before saving. A failed
 * probe cannot tell a bad key from a network restriction or provider outage,
 * so the first refusal explains itself and the next Save goes through unprobed.
 *
 * @param customKeys - The credentials as currently entered
 * @param resetKey - Resets the refusal when the form targets a new provider
 */
export function useCredentialProbeGate({
  customKeys,
  resetKey,
}: {
  customKeys: Record<string, string>;
  resetKey?: string;
}) {
  const credentialsFingerprint = useMemo(() => JSON.stringify(customKeys), [customKeys]);
  const [refusedCredentials, setRefusedCredentials] = useState<string | null>(null);

  // The component instance survives the drawer being reopened on a different
  // provider row, so the refusal has to be cleared with it.
  useEffect(() => {
    setRefusedCredentials(null);
  }, [resetKey]);

  // Editing any credential re-arms the probe, so a corrected key is checked
  // again rather than saved on the strength of the previous refusal.
  //
  // Comparing fingerprints rather than holding a boolean is what makes that
  // safe while a probe is still in flight: the refusal records the credentials
  // it was actually about, so a key edited mid-probe does not inherit the old
  // key's verdict and slip through unprobed.
  const wasRefused = refusedCredentials === credentialsFingerprint;

  // Both callbacks keep a stable identity across renders. The save handlers
  // that consume them are `useCallback`s, and this component family also keys
  // effects on callback identity — a fresh function per render re-runs those
  // effects, which set state, which renders again.
  const recordRefusal = useCallback(
    () => setRefusedCredentials(credentialsFingerprint),
    [credentialsFingerprint],
  );
  const clearRefusal = useCallback(() => setRefusedCredentials(null), []);

  return {
    /** Whether the credentials as entered still owe us a probe. */
    probeRequired: !wasRefused,
    /** Records that the provider refused exactly these credentials. */
    recordRefusal,
    /** Forgets any refusal — the credentials were accepted. */
    clearRefusal,
    /** What the save button should say, given the refusal is now readable. */
    saveLabel: wasRefused ? "Save anyway" : "Save",
  };
}

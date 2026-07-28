import { useEffect, useMemo, useState } from "react";

/**
 * Decides whether a credential still has to be probed before saving.
 *
 * A failed probe is a strong signal, not proof. It runs from our servers, so a
 * key restricted to the customer's own network, a provider outage, and a key
 * that has not finished propagating all look exactly like a bad key. Refusing
 * to save at all leaves those customers with nowhere to go, so the first
 * refusal explains itself and the next Save goes through unprobed.
 *
 * This lives beside `useModelProviderApiKeyValidation` rather than inside it
 * because the two answer different questions — that one runs the probe, this
 * one decides whether to — and because every surface that runs the probe needs
 * this answer. The drawer, onboarding and the Langy model gate otherwise
 * disagree about whether a refusal is the end of the road.
 *
 * @param customKeys - The credentials as currently entered
 * @param resetKey - Changes when the form is pointed at a different provider,
 *   so a refusal does not outlive the credential it was about
 */
export function useCredentialProbeGate({
  customKeys,
  resetKey,
}: {
  customKeys: Record<string, string>;
  resetKey?: string;
}) {
  const credentialsFingerprint = useMemo(
    () => JSON.stringify(customKeys),
    [customKeys],
  );
  const [refusedCredentials, setRefusedCredentials] = useState<string | null>(
    null,
  );

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

  return {
    /** Whether the credentials as entered still owe us a probe. */
    probeRequired: !wasRefused,
    /** Records that the provider refused exactly these credentials. */
    recordRefusal: () => setRefusedCredentials(credentialsFingerprint),
    /** Forgets any refusal — the credentials were accepted. */
    clearRefusal: () => setRefusedCredentials(null),
    /** What the save button should say, given the refusal is now readable. */
    saveLabel: wasRefused ? "Save anyway" : "Save",
  };
}

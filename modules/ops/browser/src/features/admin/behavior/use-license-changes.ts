/**
 * The drawer's changes to a reissue chain (ADR-156). A new term or seat count
 * is a replacement of the chain's newest license, delivered to a bound
 * install over sync; terms and revocation reach every live license of it.
 */
import { api } from "../../../behavior/ops-api.ts";
import {
  useOpsToaster,
  useShowErrorToast,
  type OpsToaster,
} from "../../../behavior/ops-feedback.ts";
import type { LicenseChainState } from "../model/license-chain.ts";
import { termsPayload, type TermsForm } from "../model/license-terms.ts";

const UNUSED_KEY_REASON = "Replaced by a new key before any install used it";

/**
 * A key a change signed. `forCustomer` when no install holds the chain and the
 * unused key was retired, so the customer pastes the new one; otherwise an
 * install picks it up over sync.
 */
export type SignedKey = { licenseKey: string; forCustomer: boolean };

export type ReplacementChange = {
  /** ISO 8601. The instant the replacement's term ends. */
  expiresAt: string;
  maxMembersDeveloper?: number;
};

type ShowError = ReturnType<typeof useShowErrorToast>;

/** Runs `step` on each license in turn; false, with the refusal on screen, when one fails. */
async function eachLicense({
  licenses,
  step,
  showError,
  failureTitle,
}: {
  licenses: { id: string }[];
  step: (id: string) => Promise<unknown>;
  showError: ShowError;
  failureTitle: string;
}): Promise<boolean> {
  try {
    for (const license of licenses) await step(license.id);
    return true;
  } catch (error) {
    showError({ error, fallbackTitle: failureTitle });
    return false;
  }
}

function succeeded({ toaster, title }: { toaster: OpsToaster; title: string }): void {
  toaster.create({ title, type: "success", duration: 3000 });
}

export function useLicenseChanges() {
  const utils = api.useContext();
  const toaster = useOpsToaster();
  const showError = useShowErrorToast();
  const reissue = api.licenseRegistry.reissue.useMutation();
  const retire = api.licenseRegistry.revoke.useMutation();
  const updateTerms = api.licenseRegistry.updateTerms.useMutation();
  const resetBinding = api.licenseRegistry.resetInstanceBinding.useMutation();
  const refresh = () => utils.licenseRegistry.invalidate();

  /** The signed key, or null when the registry refused; the refusal is already on screen. */
  async function signReplacement({
    chain,
    change,
    failureTitle,
  }: {
    chain: LicenseChainState;
    change: ReplacementChange;
    failureTitle: string;
  }): Promise<SignedKey | null> {
    const signed = await reissue
      .mutateAsync({ id: chain.head.id, ...change })
      .catch((error: unknown) => showError({ error, fallbackTitle: failureTitle }));
    if (!signed) return null;
    return afterSigning({ chain, licenseKey: signed.licenseKey });
  }

  /** Retires the unused key and says who the new one is for: kept even when retiring is refused. */
  async function afterSigning({
    chain,
    licenseKey,
  }: {
    chain: LicenseChainState;
    licenseKey: string;
  }): Promise<SignedKey> {
    const retired = await retireUnused({ chain });
    return { licenseKey, forCustomer: chain.unbound && retired };
  }

  /**
   * No install holds the replaced key, so it stops now rather than on a sync
   * that never comes. The registry refuses a license an install bound since
   * the drawer loaded; false, with that refusal on screen.
   */
  async function retireUnused({ chain }: { chain: LicenseChainState }): Promise<boolean> {
    const retired =
      !chain.unbound ||
      (await eachLicense({
        licenses: chain.live,
        step: (id) => retire.mutateAsync({ id, reason: UNUSED_KEY_REASON, unusedOnly: true }),
        showError,
        failureTitle: "The new key is signed, but the unused one still works: revoke it",
      }));
    await refresh();
    return retired;
  }

  async function saveTerms({ chain, form }: { chain: LicenseChainState; form: TermsForm }) {
    const saved = await eachLicense({
      licenses: chain.live,
      step: (id) => updateTerms.mutateAsync({ id, ...termsPayload(form) }),
      showError,
      failureTitle: "The terms were not saved",
    });
    await refresh();
    if (saved) succeeded({ toaster, title: "Terms saved" });
    return saved;
  }

  /** Unbinds every live license of the chain: a replacement inherited the binding. */
  async function resetInstanceBinding({ chain }: { chain: LicenseChainState }) {
    const reset = await eachLicense({
      licenses: chain.live.filter((license) => license.instanceId !== null),
      step: (id) => resetBinding.mutateAsync({ id }),
      showError,
      failureTitle: "The instance binding was not reset",
    });
    await refresh();
    if (reset) succeeded({ toaster, title: "Instance binding reset" });
  }

  return {
    signReplacement,
    afterSigning,
    saveTerms,
    resetInstanceBinding,
    isSigning: reissue.isPending || retire.isPending,
    isSavingTerms: updateTerms.isPending,
    isResetting: resetBinding.isPending,
  };
}

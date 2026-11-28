/**
 * The drawer's changes to a reissue chain (ADR-156). A new term or seat count
 * is a replacement of the chain's newest license, delivered to a bound
 * install over sync; terms and revocation reach every live license of it.
 */
import { readHandledError } from "@langwatch/handled-error/read-handled-error";

import { api } from "../../../behavior/ops-api.ts";
import {
  useOpsToaster,
  useShowErrorToast,
  type OpsToaster,
} from "../../../behavior/ops-feedback.ts";
import type { LicenseChainState } from "../model/license-chain.ts";
import { termsPayload, type TermsForm } from "../model/license-terms.ts";

const UNUSED_KEY_REASON = "Replaced by a new key before any install used it";

/** How retiring the unused key ended: `in_use` when an install bound it since the drawer loaded. */
type Retirement = "retired" | "in_use" | "failed";

/**
 * A key a change signed. `forCustomer` when no install holds the chain, so the
 * customer pastes the new one; otherwise an install picks it up over sync.
 * `unusedKeyLeft` when retiring the unused key failed and it still works.
 */
export type SignedKey = { licenseKey: string; forCustomer: boolean; unusedKeyLeft: boolean };

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

/** Retires each live license's unused key in turn; how the first failure, if any, ended it. */
async function retireEach({
  chain,
  retire,
  showError,
}: {
  chain: LicenseChainState;
  retire: (id: string) => Promise<unknown>;
  showError: ShowError;
}): Promise<Retirement> {
  try {
    for (const license of chain.live) await retire(license.id);
    return "retired";
  } catch (error) {
    showError({
      error,
      fallbackTitle: "The new key is signed, but the unused one still works: revoke it",
    });
    return readHandledError(error)?.code === "license_in_use" ? "in_use" : "failed";
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
    const retirement = await retireUnused({ chain });
    return {
      licenseKey,
      forCustomer: chain.unbound && retirement !== "in_use",
      unusedKeyLeft: retirement === "failed",
    };
  }

  /** Ends replaced keys no install used that a first attempt left working. */
  async function endUnusedKeys({ ids }: { ids: string[] }): Promise<boolean> {
    const ended = await eachLicense({
      licenses: ids.map((id) => ({ id })),
      step: (id) => retire.mutateAsync({ id, reason: UNUSED_KEY_REASON, unusedOnly: true }),
      showError,
      failureTitle: "The unused key still works",
    });
    await refresh();
    return ended;
  }

  /**
   * No install holds the replaced key, so it stops now rather than on a sync
   * that never comes. A failure stays on screen; only `in_use` means an install
   * holds the chain now, any other one leaves it unbound.
   */
  async function retireUnused({ chain }: { chain: LicenseChainState }): Promise<Retirement> {
    const retirement: Retirement = chain.unbound
      ? await retireEach({
          chain,
          retire: (id) => retire.mutateAsync({ id, reason: UNUSED_KEY_REASON, unusedOnly: true }),
          showError,
        })
      : "retired";
    await refresh();
    return retirement;
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
    endUnusedKeys,
    saveTerms,
    resetInstanceBinding,
    isSigning: reissue.isPending || retire.isPending,
    isSavingTerms: updateTerms.isPending,
    isResetting: resetBinding.isPending,
  };
}

/**
 * The Strict offer: the model on LangWatch Cloud with release_pii_redaction_model_enabled (free
 * with release_pii_redaction_model_free), the rule-based detector on a self-hosted deployment,
 * whose model endpoint the browser cannot see. Not yet answered reads as off, so it never flashes.
 */

import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { FrontendFlags } from "@langwatch/feature-flag-contract";

import type { PiiRedactionModelOffer } from "../model/pii-redaction-level-offer.ts";

export function usePiiRedactionModelOffer(): PiiRedactionModelOffer {
  const flags = useUiFlags();
  const { isSaaS } = useUiDeployment();
  if (!isSaaS) return { kind: "rule-based" };
  if (flags.flag(FrontendFlags.release_pii_redaction_model_enabled) !== true) return null;
  return {
    kind: "model",
    free: flags.flag(FrontendFlags.release_pii_redaction_model_free) === true,
  };
}

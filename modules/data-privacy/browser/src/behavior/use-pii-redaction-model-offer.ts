/**
 * The Strict offer for this page: see piiRedactionModelOfferOf. Not yet answered reads as off,
 * so it never flashes.
 */

import { useUiDeployment } from "@langwatch/browser-host/capabilities";
import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { FrontendFlags } from "@langwatch/feature-flag-contract";

import {
  type PiiRedactionModelOffer,
  piiRedactionModelOfferOf,
} from "../model/pii-redaction-level-offer.ts";

export function usePiiRedactionModelOffer(): PiiRedactionModelOffer {
  const flags = useUiFlags();
  const { isSaaS } = useUiDeployment();
  return piiRedactionModelOfferOf({
    isSaaS,
    modelFlag: flags.flag(FrontendFlags.release_pii_redaction_model_enabled) === true,
    freeFlag: flags.flag(FrontendFlags.release_pii_redaction_model_free) === true,
  });
}

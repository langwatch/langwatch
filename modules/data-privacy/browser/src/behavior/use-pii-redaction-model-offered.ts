/**
 * Whether this organization is offered Strict as the LangWatch PII Redaction Model: its
 * level picker, price and example. Not yet answered reads as off, so the page never flashes it.
 */

import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { FrontendFlags } from "@langwatch/feature-flag-contract";

export function usePiiRedactionModelOffered(): boolean {
  return useUiFlags().flag(FrontendFlags.release_pii_redaction_model_enabled) === true;
}

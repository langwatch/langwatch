import type { CheckTypes, TraceCheckFrontendDefinition } from "../types";
import { PIICheck } from "./piiCheck";
import { ToxicityCheck } from "./toxicityCheck";

// TODO: allow checks to be run to be configurable by user
export const AVAILABLE_TRACE_CHECKS: Record<
  CheckTypes,
  TraceCheckFrontendDefinition
> = {
  pii_check: PIICheck,
  toxicity_check: ToxicityCheck,
  custom: {
    name: "Custom",
    render: () => {
      throw new Error("Not implemented");
    },
  },
};

export const getTraceCheck = (name: string) => {
  for (const [key, val] of Object.entries(AVAILABLE_TRACE_CHECKS)) {
    if (key === name) return val;
  }
  return undefined;
};

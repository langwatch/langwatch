import { PIICheck } from "./piiCheck";
import type { CheckTypes, TraceCheckDefinition } from "./types";

// TODO: allow checks to be run to be configurable by user
export const AVAILABLE_TRACE_CHECKS: Record<CheckTypes, TraceCheckDefinition> =
  {
    pii_check: PIICheck,
  };

export const getTraceCheck = (name: string) => {
  for (const [key, val] of Object.entries(AVAILABLE_TRACE_CHECKS)) {
    if (key === name) return val;
  }
  return undefined;
};

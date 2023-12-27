import type { CheckTypes, TraceCheckBackendDefinition } from "../types";
import { PIICheck } from "./piiCheck";
import { ToxicityCheck } from "./toxicityCheck";
import { CustomCheck } from "./customCheck";
import { JailbreakCheck } from "./jailbreakCheck";
import { InconsistencyCheck } from "./inconsistencyCheck";

// TODO: allow checks to be run to be configurable by user
export const AVAILABLE_TRACE_CHECKS: {
  [K in CheckTypes]: TraceCheckBackendDefinition<K>;
} = {
  pii_check: PIICheck,
  toxicity_check: ToxicityCheck,
  custom: CustomCheck,
  jailbreak_check: JailbreakCheck,
  inconsistency_check: InconsistencyCheck,
};

export const getCheckExecutor = (checkType: string) => {
  for (const [key, val] of Object.entries(AVAILABLE_TRACE_CHECKS)) {
    if (key === checkType) return val;
  }
  return undefined;
};

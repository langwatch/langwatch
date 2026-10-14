/** What trace lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  EvaluatorTracesMappingToken,
  type EvaluatorTracesMappingProps,
} from "@langwatch/trace-client";

/** Trace's mapping editor over the project's recent sample traces. */
export function TracesMapping(props: EvaluatorTracesMappingProps) {
  return <Lent of={EvaluatorTracesMappingToken} props={props} />;
}

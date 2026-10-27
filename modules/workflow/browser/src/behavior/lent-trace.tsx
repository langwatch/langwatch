/** What trace lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { RenderInputOutputToken, TraceIdPeekToken } from "@langwatch/trace-client";
import type { RenderInputOutputProps, TraceIdPeekProps } from "@langwatch/trace-contract";

/** Trace's input/output viewer, rendered as trace lends it. */
export function RenderInputOutput(props: RenderInputOutputProps) {
  return <Lent of={RenderInputOutputToken} props={props} />;
}

/** Trace's eye-icon peek at one trace, rendered as trace lends it. */
export function TraceIdPeek(props: TraceIdPeekProps) {
  return <Lent of={TraceIdPeekToken} props={props} />;
}

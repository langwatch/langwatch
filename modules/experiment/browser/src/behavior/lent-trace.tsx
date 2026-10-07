/** What trace lends this module by token (ARCHITECTURE.md §10.1). */

import type { UiComponentToken } from "@langwatch/browser-host/declarations";
import { Lent } from "@langwatch/browser-host/lent";
import { RenderInputOutputToken, TraceIdPeekToken } from "@langwatch/trace-client";

/** A lent component's props, read off its token so this module needs no trace-contract edge. */
type PropsOf<Token> = Token extends UiComponentToken<infer Props> ? Props : never;

/** Trace's input/output viewer, rendered as trace lends it. */
export function RenderInputOutput(props: PropsOf<typeof RenderInputOutputToken>) {
  return <Lent of={RenderInputOutputToken} props={props} />;
}

/** Trace's eye-icon peek at one trace, rendered as trace lends it. */
export function TraceIdPeek(props: PropsOf<typeof TraceIdPeekToken>) {
  return <Lent of={TraceIdPeekToken} props={props} />;
}

/** What workflow lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent, useLent } from "@langwatch/browser-host/lent";
import {
  HoverableBigTextToken,
  RedactedFieldToken,
  type HoverableBigTextProps,
  type RedactedFieldProps,
} from "@langwatch/workflow-client";
import { Suspense } from "react";

/** Workflow's clamped text that expands into a dialog; the plain text until it loads. */
export function HoverableBigText(props: HoverableBigTextProps) {
  return <Lent of={HoverableBigTextToken} props={props} fallback={props.children} />;
}

/** Workflow's redaction marker around one trace field; the field itself while nothing lends it. */
export function RedactedField(props: RedactedFieldProps) {
  const Lent = useLent(RedactedFieldToken);
  if (Lent === undefined) return <>{props.children}</>;
  return (
    <Suspense fallback={props.loadingComponent ?? null}>
      <Lent {...props} />
    </Suspense>
  );
}

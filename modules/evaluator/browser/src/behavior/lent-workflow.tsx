/** What workflow lends this module by token (ARCHITECTURE.md §10.1). */

import { useLent } from "@langwatch/browser-host/lent";
import { RedactedFieldToken, type RedactedFieldProps } from "@langwatch/workflow-client";
import { Suspense } from "react";

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

/** Trace's way into correcting one trace, lent to annotation's queue walker (§3.4, rule 7). */

import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { Button } from "@langwatch/design-system/primitives";
import type { TraceEditButtonProps } from "@langwatch/trace-contract";
import { Pencil } from "lucide-react";

import { openTraceEditorFromConversation } from "../explorer/utils/trace-edit-mode.ts";

export function TraceEditButton({ traceId, occurredAtMs, disabled }: TraceEditButtonProps) {
  const { openDrawer } = useDrawer();

  return (
    <Button
      variant="outline"
      disabled={disabled}
      onClick={() => openTraceEditorFromConversation({ openDrawer, traceId, occurredAtMs })}
    >
      <Pencil /> Edit trace
    </Button>
  );
}

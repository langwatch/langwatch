/** Trace's way into correcting one trace, lent to annotation's queue walker (§3.4, rule 7). */

import { Button } from "@chakra-ui/react";
import type { UiTraceEditButtonProps } from "@langwatch/browser-host/declarations";
import { Pencil } from "lucide-react";

import { useDrawer } from "../../../behavior/use-drawer.ts";
import { openTraceEditorFromConversation } from "../explorer/utils/trace-edit-mode.ts";

export function TraceEditButton({ traceId, occurredAtMs, disabled }: UiTraceEditButtonProps) {
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

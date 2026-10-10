/**
 * Copies one short value (a dataset slug) and says so for two seconds. The
 * Design System owns the clipboard write; this is just the affordance.
 */

import { IconButton } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useCopyToClipboard } from "@langwatch/design-system/use-copy-to-clipboard";
import { Check, Copy } from "lucide-react";

export function CopyValueButton({ value, label }: { value: string; label: string }) {
  const { copy, copied } = useCopyToClipboard();

  return (
    <Tooltip content={copied ? "Copied" : `Copy ${label.toLowerCase()}`}>
      <IconButton
        size="2xs"
        variant="ghost"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={(event) => {
          event.stopPropagation();
          copy(value);
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </IconButton>
    </Tooltip>
  );
}

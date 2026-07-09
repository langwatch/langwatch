/**
 * Click-to-copy ID chip for the run detail drawer header.
 *
 * Matches the Traces V2 drawer chip language: the chip body itself is the
 * copy affordance and the value swaps to "copied" as confirmation — no
 * separate copy-icon chrome.
 */

import { Chip } from "~/features/traces-v2/components/TraceDrawer/Chip";
import { useCopyToClipboard } from "~/features/traces-v2/hooks/useCopyToClipboard";

export function CopyIdChip({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <Chip
      label={label}
      value={copied ? "copied" : value}
      onClick={() => copy(value)}
      tooltip={`Click to copy: ${value}`}
      maxValueWidth="140px"
      ariaLabel={`Copy ${label} ${value}`}
    />
  );
}

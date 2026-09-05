/**
 * Click-to-copy ID chip for the run detail drawer header.
 */

import { useCallback, useState } from "react";
import { SimulationChip } from "./simulation-chip";

function useCopyToClipboard() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }, []);
  return { copied, copy };
}

export function CopyIdChip({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <SimulationChip
      label={label}
      value={copied ? "copied" : value}
      onClick={() => copy(value)}
      tooltip={`Click to copy: ${value}`}
      maxValueWidth="140px"
      ariaLabel={copied ? `${label} copied` : `Copy ${label} ${value}`}
    />
  );
}

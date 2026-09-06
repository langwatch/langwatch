/**
 * Copy one short string, and say so. The card shows a command the developer has to run in
 * their own terminal, so the copy has to be one click and has to confirm it happened.
 */
import { IconButton } from "@chakra-ui/react";
import { useCopyToClipboard } from "@langwatch/design-system/use-copy-to-clipboard";
import { Check, Copy } from "lucide-react";

export function LangyCopyButton({
  value,
  label,
  size = "xs",
}: {
  value: string;
  /** What is being copied, for the accessible name. */
  label: string;
  size?: "2xs" | "xs" | "sm";
}) {
  const { copied, copy } = useCopyToClipboard();
  return (
    <IconButton
      size={size}
      variant="ghost"
      aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
      onClick={() => copy(value)}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </IconButton>
  );
}

import { Button } from "@chakra-ui/react";
import { Check, Clipboard } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Tooltip } from "../../../../../components/ui/tooltip";
import { copyToClipboard } from "./copy-to-clipboard";

export function InlineCopyButton({
  text,
  label,
}: {
  text: string;
  label: string;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    const ok = await copyToClipboard({
      text,
      successMessage: `${label} copied to clipboard`,
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Tooltip
      content={copied ? "Copied!" : `Copy ${label.toLowerCase()}`}
      openDelay={0}
      showArrow
    >
      <Button
        size="xs"
        variant="ghost"
        onClick={() => void handleCopy()}
        aria-label={`Copy ${label.toLowerCase()}`}
        colorPalette={copied ? "green" : "gray"}
        backdropFilter="blur(8px)"
        bg="bg.panel/50"
        borderRadius="lg"
        _hover={{ bg: "bg.panel/70" }}
        flexShrink={0}
        gap={1.5}
      >
        {copied ? <Check size={14} /> : <Clipboard size={14} />}
      </Button>
    </Tooltip>
  );
}

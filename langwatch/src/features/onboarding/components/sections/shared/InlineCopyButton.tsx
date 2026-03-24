import { Button } from "@chakra-ui/react";
import { Check, Clipboard } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { toaster } from "../../../../../components/ui/toaster";
import { Tooltip } from "../../../../../components/ui/tooltip";

export function InlineCopyButton({
  text,
  label,
}: {
  text: string;
  label: string;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toaster.create({
        title: "Copied",
        description: `${label} copied to clipboard`,
        type: "success",
        meta: { closable: true },
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toaster.create({
        title: "Copy failed",
        description: "Couldn't copy. Please try again.",
        type: "error",
        meta: { closable: true },
      });
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

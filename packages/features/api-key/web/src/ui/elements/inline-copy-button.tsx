/**
 * A copy button that flashes a tick when the write actually landed.
 *
 * A FAMILY-LOCAL COPY of
 * `platform/app/src/features/onboarding/components/sections/shared/InlineCopyButton.tsx`,
 * narrowed in one way: the platform component reached the toast singleton
 * through `copy-to-clipboard.ts`, and a screen may reach neither the clipboard
 * nor a toaster. It asks the host, which does both and answers whether the write
 * landed — so the tick still cannot appear for a copy that was refused, which is
 * the one behaviour in this button worth keeping.
 */

import { Button } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Check, Clipboard } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useApiKeyHost } from "../../model/api-key-host";

export function InlineCopyButton({
  text,
  label,
  onCopied,
}: {
  text: string;
  label: string;
  /** Called after a successful copy, e.g. to emit an analytics event. */
  onCopied?: () => void;
}): React.ReactElement {
  const host = useApiKeyHost();
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    const ok = await host.copyToClipboard({
      text,
      succeeded: { title: "Copied", description: `${label} copied to clipboard` },
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onCopied?.();
    }
  }

  return (
    <Tooltip content={copied ? "Copied!" : `Copy ${label.toLowerCase()}`} openDelay={0} showArrow>
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

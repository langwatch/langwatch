import { Badge, Box, HStack, IconButton, Spacer } from "@chakra-ui/react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { toaster } from "../../../components/ui/toaster";

/**
 * A preformatted code block with a badge header and a single copy button.
 * Optionally supports masking + an eye toggle for secret values.
 *
 * - `display`         — what the user sees (may contain masked tokens)
 * - `revealedDisplay` — if set, enables the eye toggle and shows this on reveal
 * - `copyValue`       — what actually goes to the clipboard (unmasked)
 */
export function CodeBlock({
  label,
  display,
  copyValue,
  revealedDisplay,
  copyToastTitle,
  ariaLabel,
}: {
  label?: string;
  display: string;
  copyValue: string;
  revealedDisplay?: string;
  copyToastTitle?: string;
  ariaLabel?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const canReveal = Boolean(revealedDisplay);
  const shown = revealed && revealedDisplay ? revealedDisplay : display;

  const handleCopy = () => {
    if (!navigator.clipboard) {
      toaster.create({
        title: "Clipboard not available — copy manually",
        type: "error",
        duration: 3000,
        meta: { closable: true },
      });
      return;
    }
    void navigator.clipboard.writeText(copyValue).then(() => {
      toaster.create({
        title: copyToastTitle ?? "Copied to clipboard",
        type: "success",
        duration: 2000,
        meta: { closable: true },
      });
    });
  };

  return (
    <Box
      position="relative"
      width="full"
      background="bg.muted"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
    >
      <HStack
        paddingX={3}
        paddingY={1.5}
        borderBottomWidth="1px"
        borderColor="border"
        background="bg.subtle"
      >
        {label && (
          <Badge size="sm" variant="subtle" fontFamily="monospace">
            {label}
          </Badge>
        )}
        <Spacer />
        {canReveal && (
          <IconButton
            aria-label={revealed ? "Hide secret values" : "Show secret values"}
            size="xs"
            variant="ghost"
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </IconButton>
        )}
        <IconButton
          aria-label={ariaLabel ?? "Copy"}
          size="xs"
          variant="ghost"
          onClick={handleCopy}
        >
          <Copy size={14} />
        </IconButton>
      </HStack>
      <Box
        as="pre"
        fontFamily="monospace"
        fontSize="xs"
        padding={3}
        overflow="auto"
        whiteSpace="pre"
        margin={0}
      >
        {shown}
      </Box>
    </Box>
  );
}

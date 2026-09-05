import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import { useCopyToClipboard } from "@langwatch/design-system/use-copy-to-clipboard";

/**
 * The platform's own code for a failure, verbatim and selectable, with the whole
 * failure one click away.
 */
export function LangyFailureReference({ code, raw }: { code: string; raw?: string }) {
  const { copied, copy } = useCopyToClipboard();
  const [isOpen, setIsOpen] = useState(false);

  if (!code && !raw) return null;

  return (
    <VStack align="stretch" gap={1}>
      <HStack gap={1.5} align="center">
        {code ? <FailureCode code={code} /> : null}
        {raw ? <DetailsToggle isOpen={isOpen} onToggle={() => setIsOpen(!isOpen)} /> : null}
        <CopyButton copied={copied} onCopy={() => copy(raw ?? code ?? "")} />
      </HStack>
      {isOpen && raw ? <FailureDetails raw={raw} /> : null}
    </VStack>
  );
}

function FailureCode({ code }: { code: string }) {
  return (
    <Text
      textStyle="2xs"
      fontFamily="mono"
      color="fg.subtle"
      userSelect="text"
      truncate
      title={code}
    >
      {code}
    </Text>
  );
}

function DetailsToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <Button size="2xs" variant="ghost" color="fg.subtle" aria-expanded={isOpen} onClick={onToggle}>
      {isOpen ? (
        <ChevronDown size={11} aria-hidden="true" />
      ) : (
        <ChevronRight size={11} aria-hidden="true" />
      )}
      {isOpen ? "Hide details" : "Show details"}
    </Button>
  );
}

/** Copies the whole failure, which is what a support thread needs, not the code. */
function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <Button
      size="2xs"
      variant="ghost"
      color={copied ? "green.fg" : "fg.subtle"}
      aria-label={copied ? "Copied the error details" : "Copy the error details"}
      onClick={onCopy}
    >
      {copied ? <Check size={11} aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
    </Button>
  );
}

/** Bounded and scrollable: a traceback is unbounded and the card is not. */
function FailureDetails({ raw }: { raw: string }) {
  return (
    <Box
      maxHeight="12rem"
      overflowY="auto"
      paddingX={2}
      paddingY={1.5}
      borderRadius="sm"
      background="bg.subtle"
    >
      <Text
        as="pre"
        textStyle="2xs"
        fontFamily="mono"
        color="fg.subtle"
        userSelect="text"
        whiteSpace="pre-wrap"
        wordBreak="break-word"
      >
        {raw}
      </Text>
    </Box>
  );
}

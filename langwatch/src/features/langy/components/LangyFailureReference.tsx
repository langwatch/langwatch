import { Button, HStack, Text } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";
import { useCopyToClipboard } from "~/features/traces-v2/hooks/useCopyToClipboard";

/**
 * The platform's own code for a failure, verbatim and selectable, with the whole
 * failure one click away.
 *
 * Every card that reports a failure shows this. The code is never the headline —
 * `resource_limit_exceeded` is our vocabulary, not the customer's — but it is
 * always THERE, because it is the one string that can be searched, quoted in a
 * support thread or pasted into an issue, and a card that knows it and hides it
 * makes the reader's problem harder than it was.
 *
 * Selectable is the point (`userSelect: text` inside a card that is otherwise a
 * click target): the first thing anyone does with a code is paste it somewhere.
 * The button copies the FULL failure document rather than just the code, because
 * that is what a support thread actually needs.
 */
export function LangyFailureReference({
  code,
  raw,
}: {
  code: string;
  raw?: string;
}) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <HStack gap={1.5} align="center">
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
      <Button
        size="2xs"
        variant="ghost"
        color={copied ? "green.fg" : "fg.subtle"}
        aria-label={copied ? "Copied the error details" : "Copy the error details"}
        onClick={() => copy(raw ?? code)}
      >
        {copied ? (
          <Check size={11} aria-hidden="true" />
        ) : (
          <Copy size={11} aria-hidden="true" />
        )}
      </Button>
    </HStack>
  );
}

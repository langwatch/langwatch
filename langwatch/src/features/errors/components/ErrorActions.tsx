import { HStack, Link, Text } from "@chakra-ui/react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export interface ErrorActionsProps {
  /** Canonical docs page for this error, when the server sent one. */
  docsUrl?: string;
  /**
   * The trace id, offered as a copyable support handle.
   *
   * This is the ONLY technical detail a customer sees. Raw `meta` and the
   * reason chain stay server-side — they're for agents and logs, not people
   * (ADR-045).
   */
  traceId?: string;
}

/**
 * The footer of an error: read the docs, copy the id to hand to support.
 *
 * Shared by the error toast and the inline alert so both offer the same
 * affordances — the only difference between the two surfaces should be where
 * they sit, not what they let you do.
 */
export function ErrorActions({ docsUrl, traceId }: ErrorActionsProps) {
  const [copied, setCopied] = useState(false);

  // Reset the confirmation so a second copy still reads as a fresh action.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(() => {
    if (!traceId || !navigator.clipboard) return;
    void navigator.clipboard.writeText(traceId).then(() => setCopied(true));
  }, [traceId]);

  if (!docsUrl && !traceId) return null;

  return (
    <HStack gap={4} marginTop={1.5} fontSize="xs">
      {docsUrl && (
        <Link
          href={docsUrl}
          target="_blank"
          rel="noreferrer"
          display="inline-flex"
          alignItems="center"
          gap={1}
          fontSize="xs"
          textDecoration="underline"
        >
          Read the docs
          <ExternalLinkIcon width={11} height={11} />
        </Link>
      )}
      {traceId && navigator.clipboard && (
        <Text
          as="button"
          type="button"
          onClick={copy}
          display="inline-flex"
          alignItems="center"
          gap={1}
          opacity={0.75}
          cursor="pointer"
          _hover={{ opacity: 1 }}
          aria-label={copied ? "Error ID copied" : "Copy error ID"}
        >
          {copied ? (
            <CheckIcon width={11} height={11} />
          ) : (
            <CopyIcon width={11} height={11} />
          )}
          {copied ? "Copied" : "Copy error ID"}
        </Text>
      )}
    </HStack>
  );
}

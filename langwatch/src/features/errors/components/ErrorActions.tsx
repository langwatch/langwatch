import { chakra, HStack, Link } from "@chakra-ui/react";
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
  const [failed, setFailed] = useState(false);
  // Read the clipboard API after mount, never during render: Node defines
  // `navigator` without `clipboard`, so a render-time check disagrees between
  // server and client and mismatches on hydration.
  const [canCopy, setCanCopy] = useState(false);
  useEffect(() => setCanCopy(!!navigator?.clipboard), []);

  // Reset the confirmation so a second copy still reads as a fresh action.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(() => {
    if (!traceId || !navigator.clipboard) return;
    void navigator.clipboard.writeText(traceId).then(
      () => {
        setFailed(false);
        setCopied(true);
      },
      // Rejects when the document isn't focused or permission is denied —
      // routine in Safari. Say so rather than leaving the label unchanged.
      () => setFailed(true),
    );
  }, [traceId]);

  if (!docsUrl && !traceId) return null;

  return (
    <HStack gap={3} marginTop={2} fontSize="11.5px" color="fg.subtle">
      {docsUrl && (
        <Link
          href={docsUrl}
          target="_blank"
          rel="noreferrer"
          display="inline-flex"
          alignItems="center"
          gap={1}
          fontSize="11.5px"
          fontWeight="560"
          // The one accent, spent on the action — matching Langy's rule that
          // colour goes on the way forward, not on the trouble.
          color="orange.fg"
          textDecoration="none"
          _hover={{ textDecoration: "underline" }}
        >
          Read the docs
          <ExternalLinkIcon width={10} height={10} />
        </Link>
      )}
      {traceId && canCopy && (
        <chakra.button
          type="button"
          onClick={copy}
          display="inline-flex"
          alignItems="center"
          gap={1}
          cursor="pointer"
          transition="color .12s ease"
          _hover={{ color: "fg.muted" }}
          aria-label={
            failed
              ? "Couldn't copy the error ID"
              : copied
                ? "Error ID copied"
                : "Copy error ID"
          }
        >
          {copied ? (
            <CheckIcon width={10} height={10} />
          ) : (
            <CopyIcon width={10} height={10} />
          )}
          {failed ? "Couldn't copy" : copied ? "Copied" : "Copy error ID"}
        </chakra.button>
      )}
    </HStack>
  );
}

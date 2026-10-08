import { chakra, HStack, Link } from "@langwatch/design-system/primitives";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * The footer of a failed panel: a docs link when the server sent one, and the
 * error id as a small copy action to hand to support.
 */
export function ErrorActions({
  docsUrl,
  traceId,
}: {
  /** Canonical docs page for this error, when the server sent one. */
  docsUrl?: string;
  /** The id a customer quotes to support. */
  traceId?: string;
}) {
  const [isCopied, setIsCopied] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  // Read after mount, never during render: Node defines `navigator` without
  // `clipboard`, so a render-time check would mismatch on hydration.
  const [canCopy, setCanCopy] = useState(false);
  useEffect(() => setCanCopy(!!navigator?.clipboard), []);

  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [isCopied]);

  const copy = useCallback(() => {
    if (!traceId || !navigator.clipboard) return;
    void navigator.clipboard.writeText(traceId).then(
      () => {
        setHasFailed(false);
        setIsCopied(true);
      },
      // Rejects when the document is not focused or permission is denied.
      () => setHasFailed(true),
    );
  }, [traceId]);

  if (!docsUrl && !traceId) return null;

  const copiedLabel = isCopied ? "Copied" : "Copy error ID";
  const copyLabel = hasFailed ? "Couldn't copy" : copiedLabel;

  return (
    <HStack gap={3} marginTop={1} fontSize="11.5px" color="fg.subtle">
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
          color="orange.fg"
          textDecoration="none"
          _hover={{ textDecoration: "underline" }}
        >
          Read the docs
          <ExternalLinkIcon width={10} height={10} />
        </Link>
      )}
      {/* Without a clipboard, the id as selectable text is the only handle. */}
      {traceId && (!canCopy || hasFailed) && (
        <chakra.span userSelect="all" title={`Error ID: ${traceId}`}>
          Error ID: {traceId}
        </chakra.span>
      )}
      {traceId && canCopy && (
        <chakra.button
          type="button"
          onClick={copy}
          display="inline-flex"
          alignItems="center"
          gap={1}
          cursor="pointer"
          title={`Error ID: ${traceId}`}
          _hover={{ textDecoration: "underline" }}
        >
          {isCopied ? <CheckIcon width={10} height={10} /> : <CopyIcon width={10} height={10} />}
          {copyLabel}
        </chakra.button>
      )}
    </HStack>
  );
}

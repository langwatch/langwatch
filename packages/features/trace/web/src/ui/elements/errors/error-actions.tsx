import { chakra, HStack, Link, type SystemStyleObject } from "@chakra-ui/react";
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
  /**
   * The row's colour, and the docs link's. A surface that paints a saturated
   * fill passes `inherit` for both: the fill already sets a contrast colour,
   * and an accent has nothing to sit on there.
   */
  color?: SystemStyleObject["color"];
  accentColor?: SystemStyleObject["color"];
}

/**
 * The footer of an error: read the docs, copy the id to hand to support.
 *
 * Shared by the error toast and the inline alert so both offer the same
 * affordances — the only difference between the two surfaces should be where
 * they sit, not what they let you do.
 */
export function ErrorActions({
  docsUrl,
  traceId,
  color = "fg.subtle",
  accentColor = "orange.fg",
}: ErrorActionsProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  // Read the clipboard API after mount, never during render: Node defines
  // `navigator` without `clipboard`, so a render-time check disagrees between
  // server and client and mismatches on hydration.
  const [canCopy, setCanCopy] = useState(false);
  useEffect(() => setCanCopy(!!navigator?.clipboard), []);

  // Reset the confirmation so a second copy still reads as a fresh action.
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
      // Rejects when the document isn't focused or permission is denied —
      // routine in Safari. Say so rather than leaving the label unchanged.
      () => setHasFailed(true),
    );
  }, [traceId]);

  if (!docsUrl && !traceId) return null;

  return (
    <HStack gap={3} marginTop={2} fontSize="11.5px" color={color}>
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
          color={accentColor}
          textDecoration="none"
          _hover={{ textDecoration: "underline" }}
        >
          Read the docs
          <ExternalLinkIcon width={10} height={10} />
        </Link>
      )}
      {/*
        No clipboard API — an insecure origin (a self-hosted instance on plain
        http), or a browser that withholds it. The id is the only handle a
        customer has to give support, so it is shown as text rather than
        withheld along with the button that would have copied it.

        `hasFailed` is the same predicament arrived at the other way: the API
        exists, so the button rendered, but the write was refused (an unfocused
        document, a denied permission). `hasFailed` only clears on a later
        success, so without this the button reads "Couldn't copy" for good and
        the id is unobtainable — worst on the anonymous share page, where it is
        the viewer's only handle to quote.
      */}
      {traceId && (!canCopy || hasFailed) && (
        <chakra.span userSelect="all">Error ID: {traceId}</chakra.span>
      )}
      {traceId && canCopy && (
        <chakra.button
          type="button"
          onClick={copy}
          display="inline-flex"
          alignItems="center"
          gap={1}
          cursor="pointer"
          // Underline rather than a colour shift, which needs to know what it
          // is painted on. This reads the same on a panel and on a fill.
          _hover={{ textDecoration: "underline" }}
          // No `aria-label`: the visible text already names the action, and an
          // override that says something ELSE ("Error ID copied" over a button
          // reading "Copied") breaks voice control, which targets what the user
          // can see. Label and text must agree, so there is only one of them.
        >
          {isCopied ? <CheckIcon width={10} height={10} /> : <CopyIcon width={10} height={10} />}
          {hasFailed ? "Couldn't copy" : isCopied ? "Copied" : "Copy error ID"}
        </chakra.button>
      )}
    </HStack>
  );
}

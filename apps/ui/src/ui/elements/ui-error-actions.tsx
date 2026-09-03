/**
 * The footer of an error toast: read the docs, copy the id to hand to support.
 *
 * `BrowserUiFeedback` puts `docsUrl` and `traceId` on the toast's `meta`; this
 * is what turns them into something a reader can use. The trace id is the ONLY
 * technical detail a customer is shown — raw `meta` and the reason chain stay
 * server-side, because they are for agents and logs (ADR-045).
 *
 * A leaner port of `platform/app`'s `ErrorActions`: the inline alert that
 * shared it there has not moved here yet, so this renders only what the toast
 * needs. When `<HandledErrorAlert>` follows, it renders this same row.
 */

import { chakra, HStack, Link } from "@chakra-ui/react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export type UiErrorActionsProps = {
  /** Canonical docs page for this error, when the server sent one. */
  docsUrl?: string;
  /** The trace id, offered as a copyable support handle. */
  traceId?: string;
};

/** Reads the docs link and trace id a failure toast carried on its `meta`. */
export function readUiErrorActions(meta: Record<string, unknown> | undefined): UiErrorActionsProps {
  return {
    ...(typeof meta?.docsUrl === "string" ? { docsUrl: meta.docsUrl } : {}),
    ...(typeof meta?.traceId === "string" ? { traceId: meta.traceId } : {}),
  };
}

export function UiErrorActions({ docsUrl, traceId }: UiErrorActionsProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  // Read the clipboard API after mount, never during render: jsdom and Node
  // define `navigator` without `clipboard`, so a render-time check disagrees
  // between the first and second render and mismatches on hydration.
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
          color="orange.fg"
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
        withheld along with the button that would have copied it. `hasFailed`
        is the same predicament arrived at the other way: the API exists, so
        the button rendered, but the write was refused.
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
          // override that says something else breaks voice control, which
          // targets what the user can see.
        >
          {isCopied ? <CheckIcon width={10} height={10} /> : <CopyIcon width={10} height={10} />}
          {hasFailed ? "Couldn't copy" : isCopied ? "Copied" : "Copy error ID"}
        </chakra.button>
      )}
    </HStack>
  );
}

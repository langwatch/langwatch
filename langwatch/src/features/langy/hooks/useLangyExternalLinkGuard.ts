import { useCallback, useRef, useState } from "react";

import type {
  LangyExternalLinkDialogProps,
  LangyExternalLinkTarget,
} from "../components/LangyExternalLinkDialog";
import { classifyLangyLinkDestination } from "../logic/langyLinkDestination";

export interface LangyExternalLinkGuard {
  /** Spread onto the Langy panel root. */
  guardProps: {
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
    onAuxClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
  };
  /** Spread onto <LangyExternalLinkDialog />. */
  dialogProps: LangyExternalLinkDialogProps;
}

/**
 * Marks an anchor as LangWatch's own chrome: a link one of our components
 * hardcodes (the codex sign-in's "Open openai.com" button, say), as opposed
 * to a link written by the model. The guard lets marked anchors straight
 * through: the dialog exists to read destinations the AGENT wrote, and
 * stopping the product's own buttons makes them sound dangerous.
 *
 * Safe as an opt-out because model output can never carry it: the markdown
 * pipeline renders no raw HTML and emits no data attributes on anchors, so
 * the marker only exists where a LangWatch component spelled it out.
 */
export const LANGY_FIRST_PARTY_LINK_ATTRIBUTE = "data-langy-first-party-link";

/** Spread onto a first-party anchor (`<Link {...langyFirstPartyLinkProps}>`). */
export const langyFirstPartyLinkProps = {
  [LANGY_FIRST_PARTY_LINK_ATTRIBUTE]: "true",
} as const;

/**
 * One guard for every link the Langy panel renders.
 *
 * It listens at the panel root in the CAPTURE phase, so it sees a click before
 * the link's own handler does. That ordering is the point: a guard that runs
 * last is a guard anything downstream can step in front of, and the links here
 * are written by an agent working on data it was handed. Whatever card, answer
 * or affordance is added to the panel next inherits the check without knowing
 * it exists.
 *
 * It acts only on destinations that leave LangWatch. In-app links fall straight
 * through untouched, so the router keeps handling them and the panel stays put.
 */
export function useLangyExternalLinkGuard(): LangyExternalLinkGuard {
  const [pending, setPending] = useState<LangyExternalLinkTarget | null>(null);
  // The link that was clicked, kept past the dialog's own lifetime so closing
  // can hand the reader back to exactly where they were.
  const anchorRef = useRef<HTMLElement | null>(null);
  // `confirm` is handed to a dialog that outlives several renders, so it reads
  // the destination from a ref: stable identity, never a stale value.
  const pendingRef = useRef<LangyExternalLinkTarget | null>(null);
  pendingRef.current = pending;

  const intercept = useCallback((event: React.MouseEvent<HTMLElement>) => {
    // A right click is asking for the context menu, not for the page.
    if (event.button === 2) return;
    const target = event.target as Element | null;
    const anchor = target?.closest?.<HTMLAnchorElement>("a[href]");
    if (!anchor) return;

    // Our own chrome, declared as such, not the model's writing. It opens
    // exactly as authored (target, rel and all), with no dialog.
    if (anchor.hasAttribute(LANGY_FIRST_PARTY_LINK_ATTRIBUTE)) return;

    // The ATTRIBUTE, not `anchor.href`: the DOM property has already been
    // resolved against the page, which quietly rewrites `//evil.com` and a
    // relative path into the same shape and hides what was actually written.
    const href = anchor.getAttribute("href") ?? "";
    const destination = classifyLangyLinkDestination({
      href,
      appOrigin: typeof window === "undefined" ? "" : window.location.origin,
    });

    if (destination.kind === "internal" || destination.kind === "ignored") {
      return;
    }

    // Everything past here is stopped dead first and decided second, including
    // the gestures that would have opened a new tab (cmd / ctrl / shift /
    // middle click) and the links carrying `target="_blank"`. What matters is
    // the destination, not how it was clicked.
    event.preventDefault();
    event.stopPropagation();

    // A script or an inline document is not a place to go, and no answer has a
    // reason to offer one. It never opens, with or without a dialog.
    if (destination.kind === "unsupported") return;

    anchorRef.current = anchor;
    setPending({ url: destination.url, host: destination.host });
  }, []);

  /**
   * Hand the reader back to the link they were on. The dialog does not do this
   * itself: the app's dialogs deliberately leave focus alone, so a decision
   * made here would otherwise drop the reader at the top of the page.
   */
  const restoreFocus = useCallback(() => {
    anchorRef.current?.focus();
  }, []);

  const cancel = useCallback(() => {
    setPending(null);
    restoreFocus();
  }, [restoreFocus]);

  const confirm = useCallback(() => {
    const target = pendingRef.current;
    setPending(null);
    restoreFocus();
    if (!target) return;
    // Always a new tab, whatever the gesture was: the conversation being read
    // survives, and `noopener,noreferrer` denies the destination both a handle
    // back on this page and the address it came from (which names the project
    // and the resource being looked at).
    window.open(target.url, "_blank", "noopener,noreferrer");
  }, [restoreFocus]);

  return {
    guardProps: {
      onClickCapture: intercept,
      onAuxClickCapture: intercept,
    },
    dialogProps: {
      link: pending,
      onCancel: cancel,
      onConfirm: confirm,
    },
  };
}

import { chakra } from "@chakra-ui/react";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { isInternalHref } from "~/components/Markdown";
import { useRouter } from "~/utils/compat/next-router";

/**
 * The one anchor every Langy card links through.
 *
 * A bare `<a href="/…">` is a REAL browser navigation: it tears the app down and
 * boots it again, which takes the panel, the conversation and any turn still
 * streaming with it. Clicking "Open in Scenarios" on a card reloaded the whole
 * product. Langy must never navigate by anything but in-app routing.
 *
 * It stays a real anchor with a real `href`, deliberately. A `<div onClick>`
 * loses middle-click, ⌘-click, "copy link address", the status-bar preview and
 * keyboard focus — the whole affordance of a link — in exchange for nothing. So
 * only the PLAIN left-click is intercepted; every modified click is left to the
 * browser, which is exactly what those gestures mean.
 *
 * External destinations are left completely alone — not prevented, not stopped
 * from propagating — so the panel's own external-link guard still sees them.
 * `isInternalHref` is the shared notion of internal (Markdown links use the same
 * one); a second definition here would eventually disagree with it.
 */
export function LangySpaAnchor({
  href,
  onClick,
  children,
  ...rest
}: ComponentPropsWithoutRef<typeof chakra.a> & { href: string }) {
  const router = useRouter();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    // A modified click is a request for the browser's own behaviour: a new tab,
    // a new window, a download. Honour it.
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    if (!isInternalHref(href)) return;
    event.preventDefault();
    void router.push(href);
  };

  return (
    <chakra.a href={href} onClick={handleClick} {...rest}>
      {children}
    </chakra.a>
  );
}

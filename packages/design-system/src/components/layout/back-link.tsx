/**
 * The link back to a detail page's list, in the page header ahead of the title. Presentational
 * only: a plain click goes to `onNavigate`, so the page routes in place and never reloads.
 */
import { HStack, Link } from "@chakra-ui/react";
import { ArrowLeft } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

export function BackLink({
  href,
  onNavigate,
  children,
}: {
  href: string;
  /** Routes in place; a click the browser keeps (new tab, download) never reaches it. */
  onNavigate: (href: string) => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      color="fg.muted"
      fontSize="sm"
      flexShrink={0}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (isBrowserClick(event)) return;
        event.preventDefault();
        onNavigate(href);
      }}
    >
      <HStack gap={1}>
        <ArrowLeft size={14} aria-hidden="true" /> {children}
      </HStack>
    </Link>
  );
}

/** A click the browser keeps: a new tab, a new window, a download. */
export function isBrowserClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  if (event.defaultPrevented || event.button !== 0) return true;
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

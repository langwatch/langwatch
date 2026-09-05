import { chakra } from "@chakra-ui/react";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { isInternalHref } from "@langwatch/workflow-web/components/Markdown";
import { useRouter } from "@langwatch/ui-host/use-router";

/**
 * The one anchor every Langy card links through.
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
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
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

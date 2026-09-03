/**
 * A link out of an onboarding screen.
 *
 * `platform/app/src/components/ui/link` no longer exists — the front-door move
 * took the last of it — and a feature-web package may not import react-router
 * (ADR-004 names it), so every destination here is an anchor. On THIS family
 * that is the right answer rather than a concession, the same argument
 * `@langwatch/auth-web` makes for its own: onboarding runs in front of a
 * workspace, and each of its links either leaves for the docs or lands on a
 * page whose whole content depends on state that has just changed.
 *
 * The prop shape is the platform element's, `isExternal` included, so no call
 * site moved a character.
 */

// eslint-disable-next-line no-restricted-imports
import { Link as ChakraLink } from "@chakra-ui/react";
import type { ComponentProps } from "react";

type LinkProps = {
  href: string | undefined;
  isExternal?: boolean;
} & Omit<ComponentProps<typeof ChakraLink>, "as" | "href">;

export const Link = ({ href, isExternal, children, ...props }: LinkProps) => {
  if (isExternal) {
    return (
      <ChakraLink href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </ChakraLink>
    );
  }

  return (
    <ChakraLink href={href ?? ""} {...props}>
      {children}
    </ChakraLink>
  );
};

import {
  Link as ChakraLink,
  Link as ChakraLinkOverlay,
} from "@chakra-ui/react";
import NextLink from "next/link";
import { type ComponentProps } from "react";

type LinkProps = {
  href: string;
  isExternal?: boolean;
} & Omit<ComponentProps<typeof ChakraLink>, "as" | "href">;

export const Link = ({ href, isExternal, children, ...props }: LinkProps) => {
  if (isExternal) {
    return (
      <ChakraLink
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </ChakraLink>
    );
  }

  return (
    <ChakraLink asChild {...props}>
      <NextLink href={href}>{children}</NextLink>
    </ChakraLink>
  );
};

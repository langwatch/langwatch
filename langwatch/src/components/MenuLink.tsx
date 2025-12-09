import { HStack, Link, Spacer, Text } from "@chakra-ui/react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import type { PropsWithChildren } from "react";

export const MenuLink = ({
  paddingX = 4,
  href,
  includePath,
  children,
  icon,
  menuEnd,
  isSelectedAnnotation,
}: PropsWithChildren<{
  paddingX?: number;
  href: string;
  icon?: React.ReactNode;
  menuEnd?: React.ReactNode;
  isSelectedAnnotation?: boolean;
  includePath?: string;
}>) => {
  const pathname = usePathname();
  const selected =
    isSelectedAnnotation ??
    (pathname === href || (includePath && pathname?.includes(includePath)));

  return (
    <Link
      asChild
      paddingX={paddingX}
      paddingY={2}
      width="full"
      position="relative"
      background={isSelectedAnnotation ? "gray.50" : "transparent"}
      _hover={{ background: "gray.50" }}
      _before={{
        content: '""',
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: "4px",
        background:
          selected && !isSelectedAnnotation ? "orange.400" : "transparent",
      }}
    >
      <NextLink href={href}>
        <HStack width="full" gap={2}>
          {icon && icon}
          <Text>{children}</Text>
          <Spacer />
          {menuEnd && menuEnd}
        </HStack>
      </NextLink>
    </Link>
  );
};

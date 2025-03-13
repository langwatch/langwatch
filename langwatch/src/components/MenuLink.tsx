import type { PropsWithChildren } from "react";
import { Link, HStack, Spacer, Text } from "@chakra-ui/react";
import { usePathname } from "next/navigation";
import NextLink from "next/link";

export const MenuLink = ({
  paddingX = 4,
  href,
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
}>) => {
  const pathname = usePathname();
  const selected = isSelectedAnnotation ?? pathname === href;

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

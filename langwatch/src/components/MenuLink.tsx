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
  isSelected,
  isSelectedAnnotation,
}: PropsWithChildren<{
  paddingX?: number;
  href: string;
  icon?: React.ReactNode;
  menuEnd?: React.ReactNode;
  isSelected?: boolean;
  isSelectedAnnotation?: boolean;
  includePath?: string;
}>) => {
  const pathname = usePathname();
  const selected =
    isSelected ?? isSelectedAnnotation ??
    (pathname === href || (includePath && pathname?.includes(includePath)));

  return (
    <Link
      asChild
      paddingX={paddingX}
      paddingY={1}
      width="full"
      position="relative"
      borderRadius="lg"
      background={selected ? "gray.100" : "transparent"}
      _hover={{ background: "gray.100" }}
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

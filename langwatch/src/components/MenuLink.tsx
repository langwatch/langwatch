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
  disabled,
}: PropsWithChildren<{
  paddingX?: number;
  href: string;
  icon?: React.ReactNode;
  menuEnd?: React.ReactNode;
  isSelected?: boolean;
  isSelectedAnnotation?: boolean;
  includePath?: string;
  disabled?: boolean;
}>) => {
  const pathname = usePathname();
  const selected =
    isSelected ??
    isSelectedAnnotation ??
    (pathname === href || (includePath && pathname?.includes(includePath)));

  return (
    <Link
      asChild
      paddingX={paddingX}
      paddingY={1}
      width="full"
      position="relative"
      borderRadius="lg"
      background={!disabled && selected ? "bg.muted" : "transparent"}
      _hover={!disabled ? { background: "bg.muted" } : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      opacity={disabled ? 0.4 : undefined}
      cursor={disabled ? "not-allowed" : undefined}
      pointerEvents={disabled ? "none" : undefined}
    >
      <NextLink href={href}>
        <HStack width="full" gap={2}>
          {icon}
          <Text>{children}</Text>
          <Spacer />
          {menuEnd}
        </HStack>
      </NextLink>
    </Link>
  );
};

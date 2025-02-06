import type { PropsWithChildren } from "react";
import { Link } from "@chakra-ui/next-js";
import { usePathname } from "next/navigation";
import { HStack, Icon, Spacer, Text } from "@chakra-ui/react";

export const MenuLink = ({
  paddingX = 4,
  href,
  children,
  icon,
  menuEnd,
}: PropsWithChildren<{
  paddingX?: number;
  href: string;
  icon?: React.ComponentType<{ size?: string | number; color?: string }>;
  menuEnd?: React.ReactNode;
}>) => {
  const pathname = usePathname();
  const selected = pathname === href;

  return (
    <Link
      href={href}
      paddingX={paddingX}
      paddingY={2}
      width="full"
      position="relative"
      _hover={{ background: "gray.50" }}
      _before={{
        content: '""',
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: "4px",
        background: selected ? "orange.400" : "transparent",
      }}
    >
      <HStack width="full">
        {icon && <Icon as={icon} />}
        <Text>{children}</Text>
        <Spacer />
        {menuEnd && menuEnd}
      </HStack>
    </Link>
  );
};

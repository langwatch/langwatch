import type { PropsWithChildren } from "react";
import { Link } from "@chakra-ui/next-js";
import { usePathname } from "next/navigation";

export const MenuLink = ({
  paddingX = 4,
  href,
  children,
}: PropsWithChildren<{ paddingX?: number; href: string }>) => {
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
      {children}
    </Link>
  );
};

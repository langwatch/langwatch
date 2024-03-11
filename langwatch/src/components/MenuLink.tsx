import type { PropsWithChildren } from "react";
import { Link } from "@chakra-ui/next-js";
import { useRouter } from "next/router";
import { usePathname } from "next/navigation";
import path from "path";

export const MenuLink = ({
  href,
  children,
}: PropsWithChildren<{ href: string }>) => {
  const pathname = usePathname();
  const selected = pathname === href;

  return (
    <Link
      href={href}
      paddingX={4}
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

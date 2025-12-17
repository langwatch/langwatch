import { Link } from "@chakra-ui/react";
import NextLink from "next/link";
import type { CellContext } from "@tanstack/react-table";

interface LinkCellProps<T> {
  info: CellContext<T, unknown>;
  href: string;
  children?: React.ReactNode;
}

/**
 * Cell renderer that displays a clickable link
 */
export function LinkCell<T>({ info, href, children }: LinkCellProps<T>) {
  const value = info.getValue();
  const displayValue = children ?? (typeof value === "string" ? value : String(value));

  return (
    <Link asChild color="blue.500" _hover={{ textDecoration: "underline" }}>
      <NextLink href={href}>{displayValue}</NextLink>
    </Link>
  );
}

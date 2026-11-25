import { Link, chakra } from "@chakra-ui/react";
import type { MouseEvent, ReactNode } from "react";
import { use } from "react";

import { isBrowserClick } from "../back-link.tsx";
import { RowContext } from "./shared.ts";

export type ListTableRowActionProps = {
  /** The visible text, usually the row's name. */
  children: ReactNode;
  /** Accessible name when children is not text. */
  label?: string;
  disabled?: boolean;
} & (
  | { href: string; onNavigate: (args: { href: string }) => void; onActivate?: never }
  | { onActivate: () => void; href?: never; onNavigate?: never }
);

const LOOK = {
  color: "fg",
  fontWeight: "medium",
  textAlign: "start",
  textDecoration: "none",
  borderRadius: "xs",
  cursor: "pointer",
  _hover: { textDecoration: "underline" },
  _focusVisible: {
    outline: "2px solid",
    outlineColor: "colorPalette.focusRing",
    outlineOffset: "2px",
  },
} as const;

/**
 * The keyboard target of a row, inside its primary cell: a real link when it has `href`
 * (a plain click routes through `onNavigate`, a new-tab click is the browser's), a real
 * button otherwise. Enter and Space come from the native element.
 */
export function RowAction(props: ListTableRowActionProps) {
  const row = use(RowContext);
  const disabled = props.disabled || row.disabled;
  if (props.href === undefined) {
    return (
      <chakra.button
        type="button"
        aria-label={props.label}
        disabled={disabled}
        onClick={props.onActivate}
        {...LOOK}
        _disabled={{ cursor: "not-allowed" }}
      >
        {props.children}
      </chakra.button>
    );
  }
  const { href, onNavigate } = props;
  if (disabled) {
    return (
      <chakra.a aria-label={props.label} aria-disabled {...LOOK} cursor="not-allowed">
        {props.children}
      </chakra.a>
    );
  }
  return (
    <Link
      href={href}
      aria-label={props.label}
      variant="plain"
      {...LOOK}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (isBrowserClick(event)) return;
        event.preventDefault();
        onNavigate({ href });
      }}
    >
      {props.children}
    </Link>
  );
}

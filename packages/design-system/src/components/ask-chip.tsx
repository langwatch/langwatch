import { chakra } from "@chakra-ui/react";
import type React from "react";

/** Borrowable ask or shortcut link; deliberately near-opaque surface (legible on dark ground);
 * same look for onClick prompts and href router links */
export function AskChip({
  icon,
  label,
  onClick,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  /** Where the chip goes instead of what it asks. */
  href?: string;
}) {
  const body = (
    <>
      <chakra.span display="grid" color="fg.subtle">
        {icon}
      </chakra.span>
      {label}
    </>
  );
  const styles = {
    display: "inline-flex",
    alignItems: "center",
    gap: 1.5,
    fontSize: "12px",
    color: "fg.muted",
    background: "bg.panel/90",
    borderWidth: "1px",
    borderColor: "border.muted",
    borderRadius: "full",
    paddingX: 3,
    paddingY: "4px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "color 130ms ease, border-color 130ms ease, background 130ms ease",
    _hover: {
      color: "orange.fg",
      borderColor: "orange.emphasized",
      background: "bg.panel",
      textDecoration: "none",
    },
  } as const;

  // A plain anchor, not a client-transition link: a feature-web package may
  // not import the router (ADR-004), and every other feature-web link (e.g.
  // `router-link.tsx`) uses this same full-navigation anchor.
  if (href !== undefined) {
    return (
      <chakra.a href={href} {...styles}>
        {body}
      </chakra.a>
    );
  }
  return (
    <chakra.button type="button" onClick={onClick} {...styles}>
      {body}
    </chakra.button>
  );
}

import { chakra } from "@chakra-ui/react";
import type React from "react";

type AskChipAction =
  | { onClick?: () => void; href?: undefined; onNavigate?: undefined }
  /** Where the chip goes instead of what it asks; a plain click routes in place. */
  | { href: string; onNavigate: (href: string) => void; onClick?: undefined };

/** Borrowable ask or shortcut link; deliberately near-opaque surface (legible on dark ground);
 * same look for onClick prompts and href router links */
export function AskChip({
  icon,
  label,
  onClick,
  href,
  onNavigate,
}: { icon: React.ReactNode; label: string } & AskChipAction) {
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

  // A real anchor, so a new tab still works; a plain click routes in place.
  if (href !== undefined) {
    return (
      <chakra.a
        href={href}
        onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
          if (event.altKey) return;
          event.preventDefault();
          onNavigate(href);
        }}
        {...styles}
      >
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

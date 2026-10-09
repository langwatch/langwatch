import { Badge } from "@chakra-ui/react";

/**
 * "Enterprise plan", said the one way.
 *
 * The join-policy card and the two-step card each wrote this badge out
 * inline, identically, beside their headings — and the Access page's summary
 * tiles, which answer the very questions those cards settle, said nothing at
 * all. So a reader scanning the tiles saw "Joining: Nobody joins" with no hint
 * that turning it on is a plan away, and only learned it by reading down to
 * the card.
 *
 * It marks a control this organization's plan does not carry. It is NOT a
 * refusal and must never read as one: what the plan gates is turning something
 * ON — whatever is already in force stays in force, and can still be turned
 * off. The card beside it carries that sentence in full; this is the mark that
 * sends somebody to it.
 */
export function EnterprisePlanBadge({
  size = "sm",
  "data-testid": testId,
}: {
  /** `xs` in the compact summary tiles, `sm` beside a card's heading. */
  size?: "xs" | "sm";
  "data-testid"?: string;
}) {
  return (
    <Badge
      colorPalette="orange"
      size={size}
      variant="surface"
      data-testid={testId}
    >
      Enterprise plan
    </Badge>
  );
}

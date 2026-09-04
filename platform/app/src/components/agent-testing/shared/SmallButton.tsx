/**
 * The small button of the Agent Testing surface: a 12px label, a 13px icon and
 * a 28px line.
 *
 * It is outlined by default, which is what nearly every entry point of the page
 * wants: a quiet border that pulls no attention away from the results. A caller
 * that asks for another variant gets that variant whole, states included, so a
 * solid button keeps the hover Chakra gives it.
 *
 * @see specs/features/agent-testing/run-dialog.feature
 */

import { Button, type ButtonProps } from "@chakra-ui/react";

/**
 * The border, the panel background and the quiet hover of the outlined button.
 *
 * They belong to the outlined button alone. Applied to every variant they win
 * over the variant's own states, because a style prop outranks the recipe: a
 * solid button lightened to bg.muted on hover while its label stayed white,
 * which left the label unreadable.
 */
export function smallButtonChrome(
  variant: ButtonProps["variant"],
): Pick<ButtonProps, "borderColor" | "background" | "_hover"> {
  if (variant !== "outline") return {};

  return {
    borderColor: "border",
    background: "bg.panel",
    _hover: { borderColor: "border.emphasized", background: "bg.muted" },
  };
}

export function SmallButton({ variant = "outline", ...props }: ButtonProps) {
  return (
    <Button
      size="sm"
      variant={variant}
      height="28px"
      minHeight="28px"
      paddingX="10px"
      fontSize="12px"
      fontWeight="medium"
      gap={1.5}
      borderRadius="lg"
      {...smallButtonChrome(variant)}
      {...props}
    />
  );
}

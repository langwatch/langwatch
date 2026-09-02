/**
 * The small outlined button of the Agent Testing surface.
 *
 * Every write entry of the page reads the same: a quiet border, a 12px label
 * and a 13px icon. Nothing on the surface is a solid blue button, so no single
 * action pulls the eye away from the results.
 */

import { Button, type ButtonProps } from "@chakra-ui/react";

export function SmallButton(props: ButtonProps) {
  return (
    <Button
      size="sm"
      variant="outline"
      height="28px"
      minHeight="28px"
      paddingX="10px"
      fontSize="12px"
      fontWeight="medium"
      gap={1.5}
      borderRadius="lg"
      borderColor="border"
      background="bg.panel"
      _hover={{ borderColor: "border.emphasized", background: "bg.muted" }}
      {...props}
    />
  );
}

import { Card } from "@langwatch/design-system/primitives";
import type { ComponentProps } from "react";

/**
 * Standard card styling for home components: the same quiet hairline
 * material as Langy's briefing surfaces (bg.card, muted border, 14px
 * radius) minus its texture and accent, so only briefing wears the warm skin.
 */
export function HomeCard(props: ComponentProps<typeof Card.Root>) {
  return (
    <Card.Root
      bg="bg.card/50"
      backdropBlur={"md"}
      borderWidth="1px"
      borderColor="border"
      borderRadius="14px"
      boxShadow="none"
      _hover={{
        boxShadow: "sm",
      }}
      {...props}
    >
      <Card.Body padding={0} gap={2}>
        {props.children}
      </Card.Body>
    </Card.Root>
  );
}

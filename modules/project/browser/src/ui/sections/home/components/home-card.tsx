import { Card } from "@langwatch/design-system/primitives";
import type { ComponentProps } from "react";

/** The home's card: the design system's Card, static, with its body unpadded for the caller. */
export function HomeCard(props: ComponentProps<typeof Card.Root>) {
  return (
    <Card.Root {...props}>
      <Card.Body padding={0} gap={2}>
        {props.children}
      </Card.Body>
    </Card.Root>
  );
}

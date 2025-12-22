import { Card } from "@chakra-ui/react";
import type { ComponentProps } from "react";

/**
 * HomeCard
 * Standard card styling for home page components.
 * Consistent with WorkflowCard styling used elsewhere in the app.
 */
export function HomeCard(props: ComponentProps<typeof Card.Root>) {
  return (
    <Card.Root {...props}>
      <Card.Body padding={0} gap={2}>{props.children}</Card.Body>
    </Card.Root>
  );
}

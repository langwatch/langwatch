import { Card } from "@chakra-ui/react";
import type { ComponentProps } from "react";

/**
 * HomeCard
 * Standard card styling for home page components.
 * Consistent with WorkflowCard styling used elsewhere in the app.
 */
export function HomeCard(props: ComponentProps<typeof Card.Root>) {
  return (
    <Card.Root
      _hover={{
        boxShadow:
          "0 0 0 0 #000, 0 0 0 0 #000, 0px 2px 4px 0px rgba(0, 0, 0, 0.1)",
      }}
      {...props}
    >
      <Card.Body padding={0} gap={2}>
        {props.children}
      </Card.Body>
    </Card.Root>
  );
}

import { Card } from "@chakra-ui/react";
import type { ComponentProps } from "react";

/**
 * Standard card styling for home components: the same quiet hairline
 * material as Langy's briefing surfaces (bg.surface, muted border, 14px
 * radius) minus its texture and accent, so only briefing wears the warm skin.
 */
export function HomeCard(props: ComponentProps<typeof Card.Root>) {
  return (
    <Card.Root
      bg="bg.surface/50"
      backdropBlur={"md"}
      borderWidth="1px"
      borderColor="border"
      borderRadius="14px"
      boxShadow="none"
      _hover={{
        boxShadow: "0px 2px 4px 0px rgba(0, 0, 0, 0.08)",
      }}
      {...props}
    >
      <Card.Body padding={0} gap={2}>
        {props.children}
      </Card.Body>
    </Card.Root>
  );
}

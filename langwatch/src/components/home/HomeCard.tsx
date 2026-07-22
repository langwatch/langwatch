import { Card } from "@chakra-ui/react";
import type { ComponentProps } from "react";

/**
 * HomeCard
 * Standard card styling for home page components: the same quiet hairline
 * material as the Langy briefing surfaces (bg.surface, muted border, the
 * shared 14px card radius) minus Langy's texture and accent — so the whole
 * home reads as one system, and only the briefing wears the warm skin.
 */
export function HomeCard(props: ComponentProps<typeof Card.Root>) {
  return (
    <Card.Root
      bg="bg.surface/20"
      backdropBlur={"md"}
      borderWidth="1px"
      borderColor="border.muted"
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

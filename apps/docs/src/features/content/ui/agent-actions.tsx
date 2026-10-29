import { Button, Flex } from "@langwatch/design-system/primitives";
import { ArrowRight, Terminal } from "lucide-react";

import { pagePath } from "../../../lib/site-path.ts";

export function AgentActions() {
  return (
    <Flex gap="3" wrap="wrap" marginY="5">
      <Button
        asChild
        variant="solid"
        minHeight="44px"
        bg="docs.action"
        color="docs.actionText"
        _hover={{ bg: "docs.action", opacity: 0.88 }}
      >
        <a href="#getting-started">
          <Terminal size={16} aria-hidden="true" />
          Launch your agent
        </a>
      </Button>
      <Button
        asChild
        variant="outline"
        minHeight="44px"
        bg="docs.paper"
        color="fg"
        borderColor="border.emphasized"
        _hover={{ bg: "bg.subtle", borderColor: "fg.muted" }}
      >
        <a href={pagePath({ slug: "coding-agents/quickstart" })}>
          Follow the quickstart
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </Button>
    </Flex>
  );
}

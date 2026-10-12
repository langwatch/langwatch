import { Button, Flex } from "@langwatch/design-system/primitives";
import { ArrowRight, Terminal } from "lucide-react";

import { pagePath } from "../../../lib/site-path.ts";

export function AgentActions() {
  return (
    <Flex gap="3" wrap="wrap" marginY="5">
      <Button asChild variant="outline" colorPalette="gray" minHeight="44px">
        <a href="#getting-started">
          <Terminal size={16} aria-hidden="true" />
          Launch your agent
        </a>
      </Button>
      <Button asChild variant="outline" colorPalette="gray" minHeight="44px">
        <a href={pagePath({ slug: "coding-agents/quickstart" })}>
          Follow the quickstart
          <ArrowRight size={16} aria-hidden="true" />
        </a>
      </Button>
    </Flex>
  );
}

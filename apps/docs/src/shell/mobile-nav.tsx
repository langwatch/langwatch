import { Box, Button, Flex, Link, Text } from "@langwatch/design-system/primitives";

import { site } from "../lib/nav-model.ts";
import type { Section } from "../lib/nav-model.ts";
import { GithubLink } from "./github-link.tsx";
import { SideNav } from "./side-nav.tsx";

export function MobileNav({
  active,
  slug,
}: {
  open: boolean;
  onClose: () => void;
  active: Section | undefined;
  slug: string;
}) {
  return (
    <dialog
      id="docs-mobile-nav"
      className="docs-island-dialog docs-mobile-dialog"
      aria-labelledby="docs-mobile-title"
    >
      <Flex
        padding="5"
        alignItems="center"
        justifyContent="space-between"
        borderBottomWidth="1px"
        borderColor="border"
      >
        <Text id="docs-mobile-title" fontSize="18px" fontWeight="600">
          Documentation
        </Text>
        <Button
          data-docs-mobile-close=""
          variant="ghost"
          colorPalette="gray"
          aria-label="Close navigation"
        >
          Close
        </Button>
      </Flex>
      <Box padding="4" overflowY="auto" minHeight="0" flex="1" data-docs-scroll="">
        <SideNav active={active} slug={slug} />
      </Box>
      <Flex padding="4" gap="3" borderTopWidth="1px" borderColor="border" wrap="wrap">
        <Link href={site.llms}>Docs for agents</Link>
        <Link href={site.signIn}>Open app</Link>
        <GithubLink compact />
      </Flex>
    </dialog>
  );
}

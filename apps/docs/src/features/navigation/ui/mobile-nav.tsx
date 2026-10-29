import { Box, Button, Flex, Link, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import { sitePath } from "../../../lib/site-path.ts";
import type { SiteMeta } from "../model/nav.ts";

/**
 * The drawer ships empty: opening it copies the left rail's sections and page tree in, so
 * every page carries its navigation once. The drawer needs JavaScript to open either way.
 * `githubLink` is the shell's repository link, last in the footer.
 */
export function MobileNav({
  githubLink,
  site,
}: {
  githubLink: ReactNode;
  site: Pick<SiteMeta, "llms" | "signIn">;
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
      <Box
        padding="4"
        overflowY="auto"
        minHeight="0"
        flex="1"
        data-docs-scroll=""
        data-docs-mobile-body=""
      />
      <Flex padding="4" gap="3" borderTopWidth="1px" borderColor="border" wrap="wrap">
        <Link href={sitePath({ path: site.llms })}>Docs for agents</Link>
        <Link href={site.signIn}>Open app</Link>
        {githubLink}
      </Flex>
    </dialog>
  );
}

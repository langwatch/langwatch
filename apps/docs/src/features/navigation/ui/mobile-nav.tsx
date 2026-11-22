import { Box, Flex, IconButton, Link, Text } from "@langwatch/design-system/primitives";
import { X } from "lucide-react";
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
        paddingX="4"
        minHeight="52px"
        alignItems="center"
        justifyContent="space-between"
        borderBottomWidth="1px"
        borderColor="border"
        flexShrink={0}
      >
        <Text id="docs-mobile-title" margin="0" fontSize="15px" lineHeight="20px" fontWeight="600">
          Documentation
        </Text>
        <IconButton
          data-docs-mobile-close=""
          variant="ghost"
          colorPalette="gray"
          size="sm"
          marginInlineEnd="-2"
          aria-label="Close navigation"
        >
          <X size={18} aria-hidden="true" />
        </IconButton>
      </Flex>
      <Box
        paddingX="3"
        paddingY="3"
        overflowY="auto"
        overscrollBehavior="contain"
        minHeight="0"
        flex="1"
        data-docs-scroll=""
        data-docs-mobile-body=""
      />
      <Flex
        className="docs-mobile-footer"
        paddingX="4"
        paddingTop="2"
        gap="4"
        alignItems="center"
        borderTopWidth="1px"
        borderColor="border"
        flexShrink={0}
        fontSize="13px"
      >
        <Link href={sitePath({ path: site.llms })}>Docs for agents</Link>
        <Link href={site.signIn}>Open app</Link>
        <Box marginInlineStart="auto">{githubLink}</Box>
      </Flex>
    </dialog>
  );
}

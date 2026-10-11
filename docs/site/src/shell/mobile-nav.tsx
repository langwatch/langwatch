import { Drawer } from "@langwatch/design-system/drawer";
import { Link } from "@langwatch/design-system/primitives";

import { site } from "../lib/nav-model.ts";
import type { Section } from "../lib/nav-model.ts";
import { GithubLink } from "./github-link.tsx";
import { SideNav } from "./side-nav.tsx";

/** Modal navigation: the same two levels as the rail, with the header links in the footer. */
export function MobileNav({
  open,
  onClose,
  active,
  slug,
}: {
  open: boolean;
  onClose: () => void;
  active: Section | undefined;
  slug: string;
}) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={({ open: next }) => (next ? undefined : onClose())}
      placement="start"
      modal
      preventScroll
      closeOnInteractOutside
      size="sm"
      lazyMount
      unmountOnExit
    >
      <Drawer.Content
        margin="0"
        borderRadius="0"
        width={{ base: "100%", md: "360px" }}
        maxWidth="100%"
        bg="bg.surface"
      >
        <Drawer.Header>
          <Drawer.Title>Documentation</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body paddingX="4" data-docs-scroll="">
          <SideNav active={active} slug={slug} />
        </Drawer.Body>
        <Drawer.Footer
          paddingX="5"
          paddingY="3"
          gap="2"
          borderTopWidth="1px"
          borderColor="border.muted"
          justifyContent="space-between"
          flexWrap="wrap"
        >
          <Link
            href={site.llms}
            fontSize="14px"
            color="fg.muted"
            minHeight="44px"
            display="inline-flex"
            alignItems="center"
          >
            Docs for agents
          </Link>
          <Link
            href={site.signIn}
            fontSize="14px"
            color="fg.muted"
            minHeight="44px"
            display="inline-flex"
            alignItems="center"
          >
            Open app
          </Link>
          <GithubLink compact />
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

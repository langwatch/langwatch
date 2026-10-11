import { Drawer } from "@langwatch/design-system/drawer";
import { Box, Button, Flex, Link } from "@langwatch/design-system/primitives";
import { firstSlug, sections, site } from "../lib/nav-model.ts";
import type { Section } from "../lib/nav-model.ts";
import { NavTree } from "./nav-tree.tsx";

/** Modal navigation: sections, the active page tree and the header actions. */
export function MobileNav({ open, onClose, active, slug }: { open: boolean; onClose: () => void; active: Section | undefined; slug: string }) {
  return (
    <Drawer.Root open={open} onOpenChange={({ open: next }) => (next ? undefined : onClose())} placement="start" modal preventScroll closeOnInteractOutside size="sm" lazyMount unmountOnExit>
      <Drawer.Content margin="0" borderRadius="0" width={{ base: "100%", md: "360px" }} maxWidth="100%" bg="bg.page">
        <Drawer.Header>
          <Drawer.Title>Documentation</Drawer.Title>
        </Drawer.Header>
        <Drawer.CloseTrigger />
        <Drawer.Body paddingX="4" data-docs-scroll="">
          <Flex direction="column" paddingBottom="4" marginBottom="4" borderBottomWidth="1px" borderColor="border.muted">
            {sections.map((section) => (
              <Link
                key={section.title}
                href={`/${firstSlug({ items: section.children })}`}
                aria-current={section === active ? "page" : undefined}
                minHeight="44px"
                display="flex"
                alignItems="center"
                paddingX="3"
                borderRadius="md"
                fontSize="14px"
                fontWeight={section === active ? "600" : "400"}
                color={section === active ? "fg" : "nav.fg"}
                bg={section === active ? "nav.bgActive" : undefined}
                textDecoration="none"
              >
                {section.title}
              </Link>
            ))}
          </Flex>
          {active ? <NavTree items={active.children} current={slug} /> : null}
        </Drawer.Body>
        <Drawer.Footer gap="3" borderTopWidth="1px" borderColor="border.muted">
          <Link href={site.github} fontSize="14px" color="fg.muted">
            GitHub
          </Link>
          <Link href={site.signIn} fontSize="14px" color="fg.muted">
            Sign in
          </Link>
          <Button asChild variant="outline" colorPalette="gray" size="sm">
            <a href="https://app.langwatch.ai">Open app</a>
          </Button>
          <Box flex="1" />
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

import { Box, Flex, Link, Text } from "@langwatch/design-system/primitives";
import { GenericIcon, ICONS } from "../lib/icon-registry.tsx";
import { firstSlug, sections, support } from "../lib/nav-model.ts";
import type { Section } from "../lib/nav-model.ts";

function Tile({ icon, selected }: { icon: string; selected: boolean }) {
  const Glyph = ICONS[icon] ?? GenericIcon;
  return (
    <Flex
      aria-hidden="true"
      alignItems="center"
      justifyContent="center"
      flexShrink={0}
      width="1.5rem"
      height="1.5rem"
      borderRadius="lg"
      bg={selected ? "accent.subtle" : "fg"}
      color={selected ? "accent.fg" : "fg.inverted"}
    >
      <Glyph size={14} />
    </Flex>
  );
}

function AnchorLink({ href, title, icon, selected }: { href: string; title: string; icon: string; selected: boolean }) {
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      display="flex"
      alignItems="center"
      gap="3"
      minHeight={{ base: "44px", lg: "40px" }}
      paddingX="3"
      borderRadius="lg"
      fontSize="14px"
      lineHeight="20px"
      textDecoration="none"
      color={selected ? "accent.fg" : "nav.fg"}
      fontWeight={selected ? "600" : "400"}
      _hover={{ bg: "bg.hover", textDecoration: "none" }}
    >
      <Tile icon={icon} selected={selected} />
      <Text as="span">{title}</Text>
    </Link>
  );
}

/** The section links above the page tree: eight sections, then the global support link. */
export function SectionAnchors({ active }: { active: Section | undefined }) {
  return (
    <Box>
      <Box as="nav" aria-label="Documentation sections">
        <Box as="ul" margin="0" padding="0">
          {sections.map((section) => (
            <Box as="li" key={section.title} listStyleType="none">
              <AnchorLink href={`/${firstSlug({ items: section.children })}`} title={section.title} icon={section.icon} selected={section === active} />
            </Box>
          ))}
        </Box>
      </Box>
      <Box as="nav" aria-label="Support">
        <Box as="ul" margin="0" padding="0">
          {support.map((link) => (
            <Box as="li" key={link.title} listStyleType="none">
              <AnchorLink href={link.href} title={link.title} icon={link.icon} selected={false} />
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

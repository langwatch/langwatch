import { Box, Link, Text } from "@langwatch/design-system/primitives";
import {
  Activity,
  Blocks,
  BookOpen,
  Bot,
  Braces,
  LifeBuoy,
  Route,
  Server,
  ShieldCheck,
  SquareTerminal,
} from "lucide-react";

const SECTION_ICONS = {
  Platform: BookOpen,
  Observability: Activity,
  "AI Gateway": Route,
  "AI Governance": ShieldCheck,
  "Coding Agents": SquareTerminal,
  Langy: Bot,
  "Self Hosting": Server,
  "API Reference": Braces,
  "Get Support": LifeBuoy,
};
import { firstSlug, sections, support } from "../lib/nav-model.ts";
import type { Section } from "../lib/nav-model.ts";

function SectionGlyph({ title }: { title: string }) {
  const entry = Object.entries(SECTION_ICONS).find(([label]) => label === title);
  const Glyph = entry?.[1] ?? Blocks;
  return <Glyph size={19} strokeWidth={1.7} aria-hidden="true" />;
}

function AnchorLink({ href, title, selected }: { href: string; title: string; selected: boolean }) {
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      display="flex"
      alignItems="center"
      gap="3"
      minHeight={{ base: "44px", lg: "39px" }}
      paddingX="3"
      borderRadius="md"
      fontSize="14px"
      lineHeight="20px"
      textDecoration="none"
      color={selected ? "accent.fg" : "nav.fg"}
      fontWeight={selected ? "600" : "450"}
      bg={selected ? "accent.subtle" : "transparent"}
      marginBottom="1"
      _hover={{ bg: "bg.hover", textDecoration: "none" }}
    >
      <SectionGlyph title={title} />
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
              <AnchorLink
                href={`/${firstSlug({ items: section.children })}`}
                title={section.title}
                selected={section === active}
              />
            </Box>
          ))}
        </Box>
      </Box>
      <Box as="nav" aria-label="Support">
        <Box as="ul" margin="0" padding="0">
          {support.map((link) => (
            <Box as="li" key={link.title} listStyleType="none">
              <AnchorLink href={link.href} title={link.title} selected={false} />
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

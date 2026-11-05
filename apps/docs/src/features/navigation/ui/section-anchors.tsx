import { Box, Link, Text } from "@langwatch/design-system/primitives";
import {
  Activity,
  ArrowUpRight,
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
import type { LucideIcon } from "lucide-react";

import { publicSlug, sitePath } from "../../../lib/site-path.ts";
import { localHref } from "../model/inline.ts";
import { firstSlug } from "../model/nav.ts";
import type { Section } from "../model/nav.ts";
import { sections, support } from "./site-nav.ts";

const SECTION_ICONS: Record<string, LucideIcon> = {
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

function SectionGlyph({ title }: { title: string }) {
  const Glyph = SECTION_ICONS[title] ?? Blocks;
  return <Glyph size={18} strokeWidth={1.8} aria-hidden="true" />;
}

function AnchorLink({
  href: authored,
  title,
  selected,
}: {
  href: string;
  title: string;
  selected: boolean;
}) {
  // docs.json may spell a page of this site as an absolute URL; it still opens in place.
  const local = localHref({ href: authored });
  const external = /^https?:/.test(local);
  const href = external ? local : sitePath({ path: local });
  return (
    <Link
      href={href}
      aria-label={external ? `${title} (external site)` : title}
      aria-current={selected ? "true" : undefined}
      display="flex"
      alignItems="center"
      gap="3"
      minHeight={{ base: "44px", lg: "36px" }}
      paddingX="3"
      borderRadius="md"
      fontSize="14px"
      lineHeight="20px"
      textDecoration="none"
      color={selected ? "accent.fg" : "fg"}
      fontWeight={selected ? "600" : "450"}
      bg={selected ? "docs.raised" : "transparent"}
      marginBottom="0.5"
      boxShadow={selected ? "0 1px 3px var(--chakra-colors-docs-shadow)" : void 0}
      _hover={{
        bg: selected ? "docs.raised" : "bg.hover",
        boxShadow: selected
          ? "0 1px 3px var(--chakra-colors-docs-shadow), inset 0 0 0 1px var(--chakra-colors-border)"
          : void 0,
        textDecoration: "none",
      }}
    >
      <Box
        display="inline-flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
        width="20px"
        height="24px"
        color={selected ? "accent.fg" : "fg.muted"}
      >
        <SectionGlyph title={title} />
      </Box>
      <Text as="span" flex="1">
        {title}
      </Text>
      {external ? <ArrowUpRight size={16} aria-hidden="true" /> : null}
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
                href={`/${publicSlug({ slug: firstSlug({ items: section.children }) })}`}
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

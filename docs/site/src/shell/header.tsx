import { FullLogo } from "@langwatch/design-system/full-logo";
import { GitHubIcon } from "@langwatch/design-system/icons";
import { Kbd } from "@langwatch/design-system/kbd";
import { Box, Button, Flex, IconButton, Link, Text } from "@langwatch/design-system/primitives";
import { Menu as MenuIcon, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { firstSlug, site, sections } from "../lib/nav-model.ts";
import type { Section } from "../lib/nav-model.ts";
import { FRAME_MAX, GUTTER } from "./layout.ts";
import type { PageKind } from "./layout.ts";
import { ThemeMenu } from "./theme-menu.tsx";

function useShortcutLabel() {
  const [label, setLabel] = useState("⌘ K");
  useEffect(() => {
    if (!/Mac|iPhone|iPad/.test(navigator.platform)) setLabel("Ctrl K");
  }, []);
  return label;
}

function SectionTabs({ active, frameMax }: { active: Section | undefined; frameMax: string }) {
  useEffect(() => {
    document.querySelector('[data-docs-section][aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);
  return (
    <Box as="nav" aria-label="Documentation sections" borderBottomWidth="1px" borderColor="border.muted">
      <Flex
        maxWidth={frameMax}
        marginX="auto"
        paddingX={GUTTER}
        tabIndex={-1}
        overflowX="auto"
        css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
      >
        {sections.map((section) => {
          const current = section === active;
          return (
            <Link
              key={section.title}
              href={`/${firstSlug({ items: section.children })}`}
              data-docs-section=""
              aria-current={current ? "page" : undefined}
              display="inline-flex"
              alignItems="center"
              flexShrink={0}
              minHeight="44px"
              paddingX="3"
              fontSize="14px"
              lineHeight="20px"
              whiteSpace="nowrap"
              textDecoration="none"
              fontWeight={current ? "600" : "500"}
              color={current ? "fg" : "fg.muted"}
              boxShadow={current ? "inset 0 -2px 0 var(--chakra-colors-accent-solid)" : undefined}
              _hover={{ color: "fg", bg: "bg.hover", textDecoration: "none" }}
            >
              {section.title}
            </Link>
          );
        })}
      </Flex>
    </Box>
  );
}

export function Header({ active, kind, onSearch, onMenu }: { active: Section | undefined; kind: PageKind; onSearch: () => void; onMenu: () => void }) {
  const shortcut = useShortcutLabel();
  return (
    <Box as="header" position="sticky" top="0" zIndex="sticky" bg="bg.surface" data-kind={kind}>
      <Flex
        alignItems="center"
        gap="3"
        maxWidth={FRAME_MAX[kind]}
        marginX="auto"
        paddingX={GUTTER}
        height={{ base: "56px", lg: "64px" }}
      >
        <IconButton
          variant="ghost"
          colorPalette="gray"
          aria-label="Open navigation"
          display={{ base: "inline-flex", lg: "none" }}
          minWidth="44px"
          height="44px"
          marginInlineStart="-2"
          onClick={onMenu}
        >
          <MenuIcon size={20} aria-hidden="true" />
        </IconButton>
        <Flex alignItems="center" gap="2" flexShrink={0}>
          <Link href="/introduction" aria-label="LangWatch documentation" display="inline-flex" alignItems="center" minHeight="44px" _hover={{ textDecoration: "none" }}>
            <FullLogo width={128} height={31} />
          </Link>
          <Text display={{ base: "none", xl: "block" }} fontSize="14px" color="fg.muted">
            Docs
          </Text>
        </Flex>
        <Button
          type="button"
          variant="outline"
          colorPalette="gray"
          onClick={onSearch}
          display={{ base: "none", lg: "flex" }}
          alignItems="center"
          justifyContent="flex-start"
          gap="2"
          height="40px"
          width={{ lg: "15rem", xl: "22.5rem" }}
          maxWidth="100%"
          paddingX="3"
          fontWeight="400"
          color="fg.muted"
          marginInlineStart={{ lg: "4", xl: "8" }}
        >
          <Search size={16} aria-hidden="true" />
          <Text as="span" flex="1" textAlign="start" fontSize="14px">
            {site.searchPrompt}
          </Text>
          <Kbd>{shortcut}</Kbd>
        </Button>
        <Box flex="1" />
        <IconButton
          variant="ghost"
          colorPalette="gray"
          aria-label="Search the docs"
          display={{ base: "inline-flex", lg: "none" }}
          minWidth="44px"
          height="44px"
          onClick={onSearch}
        >
          <Search size={20} aria-hidden="true" />
        </IconButton>
        <Link
          href={site.github}
          display={{ base: "none", lg: "inline-flex" }}
          alignItems="center"
          gap="2"
          minHeight="44px"
          fontSize="14px"
          color="fg.muted"
          aria-label="GitHub"
          textDecoration="none"
          _hover={{ color: "fg", textDecoration: "none" }}
        >
          <GitHubIcon size={20} />
          <Text as="span" display={{ base: "none", xl: "inline" }}>
            GitHub
          </Text>
        </Link>
        <Link href={site.signIn} display={{ base: "none", lg: "inline-flex" }} alignItems="center" minHeight="44px" fontSize="14px" color="fg.muted" textDecoration="none" _hover={{ color: "fg", textDecoration: "none" }}>
          Sign in
        </Link>
        <Button asChild variant="outline" colorPalette="gray" size="sm" display={{ base: "none", lg: "inline-flex" }}>
          <a href="https://app.langwatch.ai">Open app</a>
        </Button>
        <ThemeMenu />
      </Flex>
      <SectionTabs active={active} frameMax={FRAME_MAX[kind]} />
    </Box>
  );
}

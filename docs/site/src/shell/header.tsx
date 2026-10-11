import { FullLogo } from "@langwatch/design-system/full-logo";
import { Kbd } from "@langwatch/design-system/kbd";
import { Box, Button, Flex, IconButton, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowUpRight, Menu as MenuIcon, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { site } from "../lib/nav-model.ts";
import { GithubLink } from "./github-link.tsx";
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

export function Header({
  kind,
  onSearch,
  onMenu,
}: {
  kind: PageKind;
  onSearch: () => void;
  onMenu: () => void;
}) {
  const shortcut = useShortcutLabel();
  return (
    <Box
      as="header"
      position="sticky"
      top="0"
      zIndex="sticky"
      data-kind={kind}
      borderBottomWidth="1px"
      borderColor="border"
      css={{
        backgroundColor: "var(--chakra-colors-docs-chrome)",
        backdropFilter: "blur(32px) saturate(150%)",
        "@media (forced-colors: active), (prefers-reduced-transparency: reduce)": {
          backgroundColor: "var(--chakra-colors-bg-surface)",
          backdropFilter: "none",
        },
      }}
    >
      <Box
        display={{ base: "flex", lg: "grid" }}
        alignItems="center"
        gap={{ base: "2", lg: "6" }}
        maxWidth={FRAME_MAX.endpoint}
        marginX="auto"
        paddingX={GUTTER}
        height={{ base: "56px", lg: "72px" }}
        gridTemplateColumns={{ lg: "1fr minmax(15rem, 28rem) 1fr" }}
      >
        <Flex alignItems="center" gap="3" paddingInlineStart={{ base: "0", lg: "4" }}>
          <IconButton
            variant="ghost"
            colorPalette="gray"
            aria-label="Open navigation"
            display={{ base: "inline-flex", lg: "none" }}
            minWidth="44px"
            height="44px"
            marginInlineStart="-2"
            data-docs-mobile=""
            onClick={onMenu}
          >
            <MenuIcon size={20} aria-hidden="true" />
          </IconButton>
          <Link
            href="/introduction"
            aria-label="LangWatch documentation"
            display="inline-flex"
            alignItems="center"
            minHeight="44px"
            _hover={{ textDecoration: "none" }}
          >
            <FullLogo width={128} height={31.38} />
          </Link>
          <Text
            display={{ base: "none", lg: "block" }}
            borderInlineStartWidth="1px"
            borderColor="border"
            paddingInlineStart="3"
            color="docs.lede"
            fontSize="14px"
          >
            Docs
          </Text>
        </Flex>
        <Button
          type="button"
          variant="outline"
          colorPalette="gray"
          data-docs-search=""
          onClick={onSearch}
          display={{ base: "none", lg: "flex" }}
          alignItems="center"
          justifyContent="flex-start"
          gap="2"
          height="40px"
          width="100%"
          borderRadius="lg"
          paddingX="3"
          fontWeight="400"
          color="fg.muted"
          bg="docs.raised"
        >
          <Search size={16} aria-hidden="true" />
          <Text as="span" flex="1" textAlign="start" fontSize="14px">
            {site.searchPrompt}
          </Text>
          <Kbd>{shortcut}</Kbd>
        </Button>
        <Flex
          alignItems="center"
          justifyContent="flex-end"
          gap={{ base: "1", lg: "4" }}
          marginInlineStart={{ base: "auto", lg: "0" }}
        >
          <IconButton
            variant="ghost"
            colorPalette="gray"
            aria-label="Search the docs"
            display={{ base: "inline-flex", lg: "none" }}
            minWidth="44px"
            height="44px"
            data-docs-search=""
            onClick={onSearch}
          >
            <Search size={20} aria-hidden="true" />
          </IconButton>
          <Box display={{ base: "none", xl: "block" }}>
            <GithubLink compact />
          </Box>
          <Link
            href={site.signIn}
            display={{ base: "none", lg: "inline-flex" }}
            alignItems="center"
            gap="2"
            minHeight="40px"
            paddingX="4"
            borderRadius="lg"
            bg="fg"
            color="bg.surface"
            fontSize="14px"
            fontWeight="600"
            textDecoration="none"
            _hover={{ bg: "docs.body", textDecoration: "none" }}
          >
            Open app <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
          <ThemeMenu />
        </Flex>
      </Box>
    </Box>
  );
}

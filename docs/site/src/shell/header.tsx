import { FullLogo } from "@langwatch/design-system/full-logo";
import { Kbd } from "@langwatch/design-system/kbd";
import { Box, Button, Flex, IconButton, Link, Text } from "@langwatch/design-system/primitives";
import { Menu as MenuIcon, Search } from "lucide-react";
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
  const quiet = {
    color: "fg.muted",
    textDecoration: "none",
    _hover: { color: "fg", textDecoration: "none" },
  };
  return (
    <Box
      as="header"
      position="sticky"
      top="0"
      zIndex="sticky"
      data-kind={kind}
      borderBottomWidth="1px"
      borderColor="border.muted"
      css={{
        backgroundColor: "color-mix(in srgb, var(--chakra-colors-bg-surface) 84%, transparent)",
        backdropFilter: "blur(24px)",
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
        height={{ base: "56px", lg: "64px" }}
        gridTemplateColumns={{ lg: "1fr minmax(15rem, 27.5rem) 1fr" }}
      >
        <Flex alignItems="center" gap="1" paddingInlineStart={{ base: "0", lg: "4" }}>
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
          height="38px"
          width="100%"
          borderRadius="xl"
          paddingX="3"
          fontWeight="400"
          color="fg.muted"
          bg="bg.surface"
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
          gap={{ base: "1", lg: "5" }}
          marginInlineStart={{ base: "auto", lg: "0" }}
        >
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
            href={site.llms}
            display={{ base: "none", lg: "inline-flex" }}
            alignItems="center"
            minHeight="44px"
            fontSize="14px"
            {...quiet}
          >
            llms.txt
          </Link>
          <Link
            href={site.signIn}
            display={{ base: "none", lg: "inline-flex" }}
            alignItems="center"
            minHeight="44px"
            fontSize="14px"
            {...quiet}
          >
            Sign In
          </Link>
          <Box display={{ base: "none", lg: "block" }}>
            <GithubLink compact />
          </Box>
          <ThemeMenu />
        </Flex>
      </Box>
    </Box>
  );
}

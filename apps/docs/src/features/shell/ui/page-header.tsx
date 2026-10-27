import { Badge, Box, Button, Flex, Heading, Text } from "@langwatch/design-system/primitives";
import { Copy } from "lucide-react";

import type { ContextualOption } from "../../navigation/model.ts";
import { PageMenu } from "./page-menu.tsx";

function CopyPageMenu({ slug, actions }: { slug: string; actions: ContextualOption[] }) {
  /* Prerendered and never hydrated: the copy island (shell/browser/copy.ts) enables and runs it. */
  const menu = actions.filter((action) => action !== "copy");
  return (
    <Flex alignItems="center" gap="2">
      <Flex>
        {actions.includes("copy") ? (
          <Button
            type="button"
            variant="outline"
            colorPalette="gray"
            size="sm"
            height="32px"
            minHeight="32px"
            paddingX="2.5"
            gap="1.5"
            fontSize="13px"
            data-docs-page-copy={slug}
            aria-keyshortcuts="Alt+Shift+C"
            title="Copy page as Markdown (Alt+Shift+C)"
            disabled
            borderEndRadius={menu.length ? "0" : undefined}
          >
            <Copy size={14} aria-hidden="true" />
            Copy page
          </Button>
        ) : null}
        {menu.length ? (
          <Box data-docs-menu-root="page" data-slug={slug} data-actions={actions.join(" ")}>
            <PageMenu slug={slug} actions={actions} />
          </Box>
        ) : null}
        {/* Beside the button, where the copy island looks for it to announce the copy. */}
        <output className="docs-sr-only" aria-live="polite" />
      </Flex>
    </Flex>
  );
}

/** A quiet mono path, as an engineer reads a file location: section, then group. */
function Breadcrumb({ trail }: { trail: string[] }) {
  const parts = trail.filter((part, index) => part && part !== trail[index - 1]);
  return (
    <Text
      as="nav"
      aria-label="Breadcrumb"
      className="docs-path"
      fontFamily="mono"
      fontSize="12px"
      lineHeight="20px"
      color="docs.lede"
      margin="0"
    >
      {parts.map((part, index) => (
        <Box as="span" key={part} color={index === parts.length - 1 ? "fg" : void 0}>
          {index > 0 ? (
            <Box as="span" className="docs-path-sep" aria-hidden="true">
              /
            </Box>
          ) : null}
          {part}
        </Box>
      ))}
    </Text>
  );
}

export function PageHeader({
  slug,
  title,
  description,
  breadcrumb,
  tag = "",
  actions = [],
}: {
  slug: string;
  title: string;
  description: string;
  breadcrumb: string[];
  tag?: string;
  actions?: ContextualOption[];
}) {
  return (
    <Box paddingTop={{ base: "7", xl: "10" }} paddingBottom="0">
      <Box className="docs-page-header">
        <Flex
          alignItems="center"
          justifyContent="space-between"
          gap="4"
          wrap="wrap"
          marginBottom="2"
          position="relative"
        >
          <Flex alignItems="center" gap="3">
            <Breadcrumb trail={breadcrumb} />
            {tag ? (
              <Badge data-docs-page-tag="" colorPalette="orange" variant="subtle" size="sm">
                {tag}
              </Badge>
            ) : null}
          </Flex>
          {slug !== "404" && actions.length ? (
            <Box className="docs-page-actions">
              <CopyPageMenu slug={slug} actions={actions} />
            </Box>
          ) : null}
        </Flex>
        <Heading
          as="h1"
          margin="0"
          position="relative"
          fontFamily="heading"
          fontWeight="400"
          fontSize={{ base: "32px", md: "42px" }}
          lineHeight={{ base: "36px", md: "46px" }}
          letterSpacing="-0.02em"
          paddingInlineEnd={{ base: "0", xl: slug === "404" ? "0" : "10rem" }}
          textWrap="pretty"
        >
          {title}
        </Heading>
        {description ? (
          <Text
            marginTop="4"
            marginBottom="0"
            position="relative"
            fontSize={{ base: "16px", md: "18px" }}
            lineHeight={{ base: "26px", md: "28px" }}
            color="docs.lede"
            maxWidth="60ch"
          >
            {description}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}

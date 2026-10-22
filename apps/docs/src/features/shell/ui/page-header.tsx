import { Badge, Box, Button, Flex, Heading, Text } from "@langwatch/design-system/primitives";
import { Check, Copy } from "lucide-react";

import { useCopy } from "../../../lib/clipboard.ts";
import { sitePath } from "../../../lib/site-path.ts";
import type { ContextualOption } from "../../navigation/model/nav.ts";
import type { PageKind } from "./header.tsx";
import { PageMenu } from "./page-menu.tsx";

async function readMarkdown({ slug }: { slug: string }): Promise<string> {
  const response = await fetch(sitePath({ path: `/${slug}.md` }));
  if (!response.ok) throw new Error("markdown unavailable");
  return response.text();
}

function CopyPageMenu({
  slug,
  title,
  actions,
}: {
  slug: string;
  title: string;
  actions: ContextualOption[];
}) {
  const { state, copy, ready } = useCopy();
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
            height={{ base: "44px", xl: "34px" }}
            minHeight={{ base: "44px", xl: "34px" }}
            data-docs-page-copy={slug}
            aria-keyshortcuts="Alt+Shift+C"
            title="Copy page as Markdown (Alt+Shift+C)"
            disabled={!ready}
            borderEndRadius={menu.length ? "0" : undefined}
            onClick={() =>
              copy({
                text: () =>
                  readMarkdown({ slug }).catch(
                    () => document.querySelector("article")?.innerText ?? "",
                  ),
              })
            }
          >
            {state === "copied" ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Copy size={16} aria-hidden="true" />
            )}
            {state === "copied" ? "Copied" : "Copy page"}
          </Button>
        ) : null}
        {menu.length ? (
          <Box data-docs-menu-root="page" data-slug={slug} data-actions={actions.join(" ")}>
            <PageMenu slug={slug} actions={actions} />
          </Box>
        ) : null}
      </Flex>
      {state === "failed" ? (
        <Text as="output" fontSize="13px" color="red.fg">
          Could not copy. Select the Markdown instead.
        </Text>
      ) : null}
      <output className="docs-sr-only" aria-live="polite">
        {state === "copied" ? `Copied ${title}` : ""}
      </output>
    </Flex>
  );
}

function Breadcrumb({ trail }: { trail: string[] }) {
  return (
    <Text
      as="nav"
      aria-label="Breadcrumb"
      fontFamily="mono"
      fontSize="12px"
      lineHeight="20px"
      letterSpacing="0.08em"
      textTransform="uppercase"
      color="accent.fg"
      fontWeight="500"
      margin="0"
    >
      {trail.at(-1)}
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
  kind: PageKind;
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
              <CopyPageMenu slug={slug} title={title} actions={actions} />
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

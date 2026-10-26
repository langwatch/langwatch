import { Badge, Box, Button, Flex, Heading, Text } from "@langwatch/design-system/primitives";
import { Check, Copy } from "lucide-react";

import { useCopy } from "../../../lib/clipboard.ts";
import { sitePath } from "../../../lib/site-path.ts";
import type { ContextualOption } from "../../navigation/model.ts";
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
            height="32px"
            minHeight="32px"
            paddingX="2.5"
            gap="1.5"
            fontSize="13px"
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
              <Check size={14} aria-hidden="true" />
            ) : (
              <Copy size={14} aria-hidden="true" />
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

import { Menu } from "@langwatch/design-system/menu";
import { Box, Button, Flex, Heading, IconButton, Text } from "@langwatch/design-system/primitives";
import { Check, ChevronDown, Copy, ExternalLink, FileText, Link2 } from "lucide-react";

import { useCopy, writeClipboard } from "../lib/clipboard.ts";
import type { PageKind } from "./layout.ts";

const ORIGIN = "https://docs.langwatch.ai";

async function readMarkdown({ slug }: { slug: string }): Promise<string> {
  const response = await fetch(`/${slug}.md`);
  if (!response.ok) throw new Error("markdown unavailable");
  return response.text();
}

function CopyPageMenu({ slug, title }: { slug: string; title: string }) {
  const { state, copy, ready } = useCopy();
  const url = `${ORIGIN}/${slug}`;
  const prompt = `Read ${url} and help me understand this page.`;
  const openIn = ({ base, note }: { base: string; note: string }) => {
    window.open(`${base}${encodeURIComponent(prompt)}`, "_blank", "noopener");
    return note;
  };
  return (
    <Flex alignItems="center" gap="2">
      <Flex>
        <Button
          type="button"
          variant="outline"
          colorPalette="gray"
          size="sm"
          height={{ base: "44px", xl: "34px" }}
          minHeight={{ base: "44px", xl: "34px" }}
          disabled={!ready}
          borderEndRadius="0"
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
        <Menu.Root positioning={{ placement: "bottom-end" }}>
          <Menu.Trigger asChild>
            <IconButton
              type="button"
              variant="outline"
              colorPalette="gray"
              size="sm"
              height={{ base: "44px", xl: "34px" }}
              minHeight={{ base: "44px", xl: "34px" }}
              disabled={!ready}
              aria-label="More page actions"
              borderStartRadius="0"
              marginInlineStart="-1px"
            >
              <ChevronDown size={16} aria-hidden="true" />
            </IconButton>
          </Menu.Trigger>
          <Menu.Content minWidth="14rem">
            <Menu.Item value="markdown" asChild>
              <a href={`/${slug}.md`}>
                <FileText size={16} aria-hidden="true" /> View as Markdown
              </a>
            </Menu.Item>
            <Menu.Item
              value="claude"
              onClick={() => openIn({ base: "https://claude.ai/new?q=", note: "claude" })}
            >
              <ExternalLink size={16} aria-hidden="true" /> Open in Claude
            </Menu.Item>
            <Menu.Item
              value="chatgpt"
              onClick={() => openIn({ base: "https://chatgpt.com/?q=", note: "chatgpt" })}
            >
              <ExternalLink size={16} aria-hidden="true" /> Open in ChatGPT
            </Menu.Item>
            <Menu.Item value="link" onClick={() => writeClipboard({ text: url })}>
              <Link2 size={16} aria-hidden="true" /> Copy page link
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
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
      fontSize="14px"
      lineHeight="20px"
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
}: {
  slug: string;
  title: string;
  description: string;
  breadcrumb: string[];
  kind: PageKind;
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
          <Breadcrumb trail={breadcrumb} />
          {slug !== "404" ? (
            <Box className="docs-page-actions">
              <CopyPageMenu slug={slug} title={title} />
            </Box>
          ) : null}
        </Flex>
        <Heading
          as="h1"
          margin="0"
          position="relative"
          fontFamily="heading"
          fontWeight="650"
          fontSize={{ base: "28px", md: "34px" }}
          lineHeight={{ base: "36px", md: "42px" }}
          letterSpacing="-0.025em"
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

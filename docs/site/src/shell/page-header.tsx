import { Box, Button, Flex, Heading, Text } from "@langwatch/design-system/primitives";
import { Check, Copy } from "lucide-react";

import { useCopy } from "../lib/clipboard.ts";
import type { PageKind } from "./layout.ts";
import { PageMenu } from "./page-menu.tsx";

async function readMarkdown({ slug }: { slug: string }): Promise<string> {
  const response = await fetch(`/${slug}.md`);
  if (!response.ok) throw new Error("markdown unavailable");
  return response.text();
}

function CopyPageMenu({ slug, title }: { slug: string; title: string }) {
  const { state, copy, ready } = useCopy();
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
          data-docs-page-copy={slug}
          aria-keyshortcuts="Alt+Shift+C"
          title="Copy page as Markdown (Alt+Shift+C)"
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
        <Box data-docs-menu-root="page" data-slug={slug}>
          <PageMenu slug={slug} />
        </Box>
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

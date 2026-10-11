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
  const { state, copy } = useCopy();
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
          minHeight="40px"
          borderEndRadius="0"
          onClick={() => copy({ text: () => readMarkdown({ slug }).catch(() => document.querySelector("article")?.innerText ?? "") })}
        >
          {state === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          {state === "copied" ? "Copied" : "Copy page"}
        </Button>
        <Menu.Root positioning={{ placement: "bottom-end" }}>
          <Menu.Trigger asChild>
            <IconButton type="button" variant="outline" colorPalette="gray" size="sm" minHeight="40px" aria-label="More page actions" borderStartRadius="0" marginInlineStart="-1px">
              <ChevronDown size={16} aria-hidden="true" />
            </IconButton>
          </Menu.Trigger>
          <Menu.Content minWidth="14rem">
            <Menu.Item value="markdown" asChild>
              <a href={`/${slug}.md`}>
                <FileText size={16} aria-hidden="true" /> View as Markdown
              </a>
            </Menu.Item>
            <Menu.Item value="claude" onClick={() => openIn({ base: "https://claude.ai/new?q=", note: "claude" })}>
              <ExternalLink size={16} aria-hidden="true" /> Open in Claude
            </Menu.Item>
            <Menu.Item value="chatgpt" onClick={() => openIn({ base: "https://chatgpt.com/?q=", note: "chatgpt" })}>
              <ExternalLink size={16} aria-hidden="true" /> Open in ChatGPT
            </Menu.Item>
            <Menu.Item value="link" onClick={() => writeClipboard({ text: url })}>
              <Link2 size={16} aria-hidden="true" /> Copy page link
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </Flex>
      {state === "failed" ? (
        <Text as="span" fontSize="13px" color="red.fg" role="status">
          Could not copy. Select the Markdown instead.
        </Text>
      ) : null}
      <span className="docs-sr-only" role="status" aria-live="polite">
        {state === "copied" ? `Copied ${title}` : ""}
      </span>
    </Flex>
  );
}

function Breadcrumb({ trail }: { trail: string[] }) {
  return (
    <Text as="nav" aria-label="Breadcrumb" fontSize="12px" lineHeight="16px" color="fg.muted" margin="0">
      {trail.map((part, index) => (
        <span key={`${part}-${index}`}>
          {index > 0 ? (
            <Box as="span" aria-hidden="true" paddingX="2">
              /
            </Box>
          ) : null}
          <Box as="span" color={index > 0 && index === trail.length - 1 ? "accent.fg" : undefined} fontWeight={index > 0 && index === trail.length - 1 ? "500" : undefined}>
            {part}
          </Box>
        </span>
      ))}
    </Text>
  );
}

export function PageHeader({
  slug,
  title,
  description,
  breadcrumb,
  kind,
}: {
  slug: string;
  title: string;
  description: string;
  breadcrumb: string[];
  kind: PageKind;
}) {
  const endpoint = kind === "endpoint";
  return (
    <Box paddingTop={{ base: "6", xl: "12" }} paddingBottom={endpoint ? "0" : { base: "6", md: "8" }}>
      <Box className={endpoint ? undefined : "docs-glass-card"}>
        <Flex alignItems="center" justifyContent="space-between" gap="4" wrap="wrap" marginBottom="3" position="relative">
          <Breadcrumb trail={breadcrumb} />
          <Box display={{ base: "none", xl: "block" }}>
            <CopyPageMenu slug={slug} title={title} />
          </Box>
        </Flex>
        <Heading
          as="h1"
          margin="0"
          position="relative"
          fontFamily={endpoint ? "heading" : "display"}
          fontWeight={endpoint ? "600" : "400"}
          fontSize={endpoint ? { base: "30px", md: "36px" } : { base: "36px", md: "48px" }}
          lineHeight={endpoint ? { base: "38px", md: "44px" } : { base: "44px", md: "60px" }}
          letterSpacing="-0.025em"
          maxWidth={kind === "home" ? "24ch" : undefined}
          textWrap="balance"
        >
          {title}
        </Heading>
        {description ? (
          <Text
            marginTop="4"
            marginBottom="0"
            position="relative"
            fontSize={endpoint ? "18px" : { base: "18px", md: "20px" }}
            lineHeight={endpoint ? "28px" : { base: "28px", md: "30px" }}
            color="fg.muted"
            maxWidth="60ch"
          >
            {description}
          </Text>
        ) : null}
        <Box display={{ base: "block", xl: "none" }} marginTop="6" position="relative">
          <CopyPageMenu slug={slug} title={title} />
        </Box>
      </Box>
    </Box>
  );
}

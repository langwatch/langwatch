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
  const home = kind === "home";
  return (
    <Box paddingTop={{ base: "8", xl: "12" }} paddingBottom={home ? { base: "6", md: "8" } : "0"}>
      <Flex alignItems="center" justifyContent="space-between" gap="4" wrap="wrap" marginBottom="3">
        <Text as="nav" aria-label="Breadcrumb" fontSize="13px" lineHeight="20px" color="fg.muted" margin="0">
          {breadcrumb.join(" / ")}
        </Text>
        <Box display={{ base: "none", xl: "block" }}>
          <CopyPageMenu slug={slug} title={title} />
        </Box>
      </Flex>
      <Heading
        as="h1"
        margin="0"
        fontFamily={home ? "display" : "heading"}
        fontWeight={home ? "400" : "600"}
        fontSize={home ? { base: "36px", md: "48px" } : { base: "30px", md: "36px" }}
        lineHeight={home ? { base: "44px", md: "56px" } : { base: "38px", md: "44px" }}
        letterSpacing="-0.02em"
        maxWidth={home ? "24ch" : undefined}
        textWrap="balance"
      >
        {title}
      </Heading>
      {description ? (
        <Text marginTop="4" marginBottom="0" fontSize="18px" lineHeight="28px" color="fg.muted" maxWidth="60ch">
          {description}
        </Text>
      ) : null}
      <Box display={{ base: "block", xl: "none" }} marginTop="6">
        <CopyPageMenu slug={slug} title={title} />
      </Box>
    </Box>
  );
}

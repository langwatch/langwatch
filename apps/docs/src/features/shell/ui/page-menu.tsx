import { Menu } from "@langwatch/design-system/menu";
import { Box, IconButton, Text } from "@langwatch/design-system/primitives";
import { Check, ChevronDown, Copy, FileText, Link2 } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { sitePath } from "../../../lib/site-path.ts";

function MenuLabel({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <>
      <span className="docs-menu-icon">{icon}</span>
      <Box minWidth="0">
        <Text as="span" display="block" fontWeight="500" whiteSpace="nowrap">
          {title}
        </Text>
        <Text as="span" display="block" fontSize="12px" lineHeight="18px" color="fg.muted">
          {description}
        </Text>
      </Box>
    </>
  );
}
export function PageMenu({ slug, initialOpen = false }: { slug: string; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState(false);
  const url = `https://docs.langwatch.ai/${slug}`;
  const prompt = `Read ${url} and help me understand this page.`;
  const copy = async (kind: string) => {
    try {
      let text = url;
      if (kind === "page") {
        const response = await fetch(sitePath({ path: `/${slug}.md` }), { credentials: "omit" });
        if (!response.ok) throw new Error("Markdown unavailable");
        text = await response.text();
      }
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setError(false);
    } catch {
      setError(true);
    }
  };
  const announcement = error
    ? "Could not copy. Open the Markdown to select it."
    : copied && "Copied to clipboard";
  return (
    <Menu.Root
      open={open}
      onOpenChange={({ open: next }) => setOpen(next)}
      positioning={{ placement: "bottom-end", gutter: 6 }}
    >
      <Menu.Trigger asChild>
        <IconButton
          data-docs-page-menu=""
          type="button"
          variant="outline"
          colorPalette="gray"
          size="sm"
          height={{ base: "44px", xl: "34px" }}
          minHeight={{ base: "44px", xl: "34px" }}
          aria-label="More page actions"
          borderStartRadius="0"
          marginInlineStart="-1px"
        >
          <ChevronDown size={16} />
        </IconButton>
      </Menu.Trigger>
      <Menu.Content
        className="docs-context-menu"
        width="310px"
        maxWidth="calc(100vw - 32px)"
        padding="1.5"
        aria-label="Page actions"
      >
        <Menu.Item value="copy" closeOnSelect={false} onSelect={() => void copy("page")}>
          <MenuLabel
            icon={copied === "page" ? <Check size={16} /> : <Copy size={16} />}
            title={copied === "page" ? "Copied page" : "Copy page"}
            description="Copy this page as Markdown for LLMs · Alt+Shift+C"
          />
        </Menu.Item>
        <Menu.Item value="view" asChild>
          <a href={sitePath({ path: `/${slug}.md` })}>
            <MenuLabel
              icon={<FileText size={16} />}
              title="View as Markdown"
              description="Read the plain-text source"
            />
          </a>
        </Menu.Item>
        {["claude", "agent"].map((extension) => (
          <Menu.Item key={extension} value={`source-${extension}`} asChild>
            <a href={sitePath({ path: `/${slug}.${extension}` })}>
              <MenuLabel
                icon={<FileText size={16} />}
                title={`View .${extension}`}
                description="Plain-text page for your agent"
              />
            </a>
          </Menu.Item>
        ))}
        {[
          {
            id: "claude",
            title: "Claude",
            logo: "claude-code",
            href: `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
          },
          {
            id: "chatgpt",
            title: "ChatGPT",
            logo: "openai",
            href: `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
          },
        ].map(({ id, title, logo, href }) => (
          <Menu.Item key={id} value={id} asChild>
            <a href={href} target="_blank" rel="noopener noreferrer">
              <MenuLabel
                icon={
                  <img
                    src={sitePath({ path: `/images/logos/${logo}.svg` })}
                    alt=""
                    width={16}
                    height={16}
                  />
                }
                title={`Open in ${title}`}
                description="Ask questions about this page"
              />
            </a>
          </Menu.Item>
        ))}
        <Menu.Separator />
        <Menu.Item value="link" closeOnSelect={false} onSelect={() => void copy("link")}>
          <MenuLabel
            icon={copied === "link" ? <Check size={16} /> : <Link2 size={16} />}
            title={copied === "link" ? "Copied link" : "Copy page link"}
            description="Share a direct link to this page"
          />
        </Menu.Item>
        <Text as="output" aria-live="polite" className={error ? "docs-copy-error" : "docs-sr-only"}>
          {announcement}
        </Text>
      </Menu.Content>
    </Menu.Root>
  );
}

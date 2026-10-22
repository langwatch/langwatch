import { Menu } from "@langwatch/design-system/menu";
import { Box, IconButton, Text } from "@langwatch/design-system/primitives";
import { Check, ChevronDown, Code, Copy, FileText, Link2, Plug } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { canonicalUrl, sitePath } from "../../../lib/site-path.ts";
import type { ContextualOption } from "../../navigation/model/nav.ts";

/** The LangWatch MCP server, which searches these docs; a static site hosts no server itself. */
export const LANGWATCH_MCP_URL = "https://app.langwatch.ai/mcp";
const MCP_NAME = "langwatch";

/** Install links the editors register for a remote MCP server. */
export function editorInstallHref({ editor }: { editor: "cursor" | "vscode" }) {
  if (editor === "cursor")
    return `cursor://anysphere.cursor-deeplink/mcp/install?${new URLSearchParams({
      name: MCP_NAME,
      config: btoa(JSON.stringify({ url: LANGWATCH_MCP_URL })),
    })}`;
  return `vscode:mcp/install?${encodeURIComponent(
    JSON.stringify({ name: MCP_NAME, type: "http", url: LANGWATCH_MCP_URL }),
  )}`;
}

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
export function PageMenu({
  slug,
  actions,
  initialOpen = false,
}: {
  slug: string;
  actions: ContextualOption[];
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState(false);
  const url = canonicalUrl({ slug });
  const prompt = `Read ${url} and help me understand this page.`;
  const copy = async (kind: string) => {
    try {
      let text = kind === "mcp" ? LANGWATCH_MCP_URL : url;
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
  const logo = (name: string) => (
    <img src={sitePath({ path: `/images/logos/${name}.svg` })} alt="" width={16} height={16} />
  );
  const external = ({
    id,
    href,
    icon,
    title,
    description,
  }: {
    id: string;
    href: string;
    icon: ReactNode;
    title: string;
    description: string;
  }) => (
    <Menu.Item key={id} value={id} asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <MenuLabel icon={icon} title={title} description={description} />
      </a>
    </Menu.Item>
  );
  const items: Record<ContextualOption, () => ReactNode> = {
    copy: () => (
      <Menu.Item key="copy" value="copy" closeOnSelect={false} onSelect={() => void copy("page")}>
        <MenuLabel
          icon={copied === "page" ? <Check size={16} /> : <Copy size={16} />}
          title={copied === "page" ? "Copied page" : "Copy page"}
          description="Copy this page as Markdown for LLMs · Alt+Shift+C"
        />
      </Menu.Item>
    ),
    view: () => [
      <Menu.Item key="view" value="view" asChild>
        <a href={sitePath({ path: `/${slug}.md` })}>
          <MenuLabel
            icon={<FileText size={16} />}
            title="View as Markdown"
            description="Read the plain-text source"
          />
        </a>
      </Menu.Item>,
      ...["claude", "agent"].map((extension) => (
        <Menu.Item key={extension} value={`source-${extension}`} asChild>
          <a href={sitePath({ path: `/${slug}.${extension}` })}>
            <MenuLabel
              icon={<FileText size={16} />}
              title={`View .${extension}`}
              description="Plain-text page for your agent"
            />
          </a>
        </Menu.Item>
      )),
    ],
    claude: () =>
      external({
        id: "claude",
        href: `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
        icon: logo("claude-code"),
        title: "Open in Claude",
        description: "Ask questions about this page",
      }),
    chatgpt: () =>
      external({
        id: "chatgpt",
        href: `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`,
        icon: logo("openai"),
        title: "Open in ChatGPT",
        description: "Ask questions about this page",
      }),
    cursor: () =>
      external({
        id: "cursor",
        href: editorInstallHref({ editor: "cursor" }),
        icon: logo("cursor"),
        title: "Connect to Cursor",
        description: "Install the LangWatch MCP server",
      }),
    vscode: () =>
      external({
        id: "vscode",
        href: editorInstallHref({ editor: "vscode" }),
        icon: <Code size={16} />,
        title: "Connect to VS Code",
        description: "Install the LangWatch MCP server",
      }),
    mcp: () => (
      <Menu.Item key="mcp" value="mcp" closeOnSelect={false} onSelect={() => void copy("mcp")}>
        <MenuLabel
          icon={copied === "mcp" ? <Check size={16} /> : <Plug size={16} />}
          title={copied === "mcp" ? "Copied MCP server URL" : "Copy MCP server URL"}
          description="Connect any MCP client to LangWatch"
        />
      </Menu.Item>
    ),
  };
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
          borderStartRadius={actions.includes("copy") ? "0" : undefined}
          marginInlineStart={actions.includes("copy") ? "-1px" : undefined}
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
        {actions.map((action) => items[action]())}
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

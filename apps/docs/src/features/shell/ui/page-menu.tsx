import { Menu } from "@langwatch/design-system/menu";
import { Box, IconButton, Text } from "@langwatch/design-system/primitives";
import { Check, ChevronDown, Code, Copy, FileText, Link2, Plug } from "lucide-react";
import type { ReactNode } from "react";

import { canonicalUrl, sitePath } from "../../../lib/site-path.ts";
import type { ContextualOption } from "../../navigation/model.ts";

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
  shortcut,
  copied,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  shortcut?: string;
  /** The title and check mark a copy action switches to once it has copied. */
  copied?: string;
}) {
  return (
    <>
      <span className="docs-menu-icon">
        {icon}
        {copied ? <Check size={16} style={{ display: "none" }} /> : null}
      </span>
      <Box minWidth="0" flex="1">
        <Text
          as="span"
          display="block"
          fontWeight="500"
          whiteSpace="nowrap"
          data-docs-menu-title=""
          data-copied={copied}
        >
          {title}
        </Text>
        <Text as="span" display="block" fontSize="12px" lineHeight="18px" color="fg.muted">
          {description}
        </Text>
      </Box>
      {shortcut ? <kbd className="docs-menu-shortcut">{shortcut}</kbd> : null}
    </>
  );
}

/**
 * The page actions: a trigger, and the design system's menu drawn at build time into an inert
 * template beside it. The context menus island shows that markup as a popover and runs the copy
 * actions, so opening the menu downloads no component runtime.
 */
export function PageMenu({ slug, actions }: { slug: string; actions: ContextualOption[] }) {
  const url = canonicalUrl({ slug });
  const prompt = `Read ${url} and help me understand this page.`;
  const logo = (name: string) => (
    <img
      src={sitePath({ path: `/images/logos/${name}.svg` })}
      alt=""
      width={16}
      height={16}
      loading="lazy"
    />
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
      <Menu.Item key="copy" value="copy" data-docs-menu-copy="page">
        <MenuLabel
          icon={<Copy size={16} />}
          title="Copy page"
          copied="Copied page"
          description="As Markdown, for LLMs"
          shortcut="Alt+Shift+C"
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
      <Menu.Item key="mcp" value="mcp" data-docs-menu-copy={LANGWATCH_MCP_URL}>
        <MenuLabel
          icon={<Plug size={16} />}
          title="Copy MCP server URL"
          copied="Copied MCP server URL"
          description="Connect any MCP client to LangWatch"
        />
      </Menu.Item>
    ),
  };
  return (
    <>
      <IconButton
        data-docs-page-menu=""
        type="button"
        variant="outline"
        colorPalette="gray"
        size="sm"
        height="32px"
        minHeight="32px"
        minWidth="32px"
        width="32px"
        aria-label="More page actions"
        aria-haspopup="menu"
        aria-expanded="false"
        borderStartRadius={actions.includes("copy") ? "0" : undefined}
        marginInlineStart={actions.includes("copy") ? "-1px" : undefined}
      >
        <ChevronDown size={14} />
      </IconButton>
      <template>
        <Menu.Root open>
          <Menu.Content
            portalled={false}
            className="docs-context-menu"
            width="310px"
            maxWidth="calc(100vw - 32px)"
            padding="1.5"
            aria-label="Page actions"
          >
            {actions.map((action) => items[action]())}
            <Menu.Separator />
            <Menu.Item value="link" data-docs-menu-copy={url}>
              <MenuLabel
                icon={<Link2 size={16} />}
                title="Copy page link"
                copied="Copied link"
                description="Share a direct link to this page"
              />
            </Menu.Item>
            <output aria-live="polite" className="docs-sr-only" />
          </Menu.Content>
        </Menu.Root>
      </template>
    </>
  );
}

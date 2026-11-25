import { Box, IconButton } from "@chakra-ui/react";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { useColorMode } from "../../color-mode/index.tsx";
import { codeToHtml, codeToHtmlDark } from "../../shiki-adapter.ts";
import { useCopyToClipboard } from "../../use-copy-to-clipboard.ts";
import { TabsMachine } from "./tabs-parts/machine.tsx";

export interface CodeTabItem<Value extends string = string> {
  value: Value;
  /** "Python", "curl". */
  label: string;
  code: string;
  /** A shiki language id; the design system loads it on demand. */
  language: string;
  highlightLines?: readonly number[];
  /** "vk-usage-tab-python". */
  testId?: string;
}

export interface CodeTabsProps<Value extends string = string> {
  value: Value;
  onValueChange: (args: { value: Value }) => void;
  items: readonly CodeTabItem<Value>[];
  /** Names the tablist: "Snippet language". */
  label: string;
  /** Default "Copy code". */
  copyLabel?: string;
  testId?: string;
}

const BODY_CSS = {
  "& pre": {
    margin: 0,
    padding: "12px 16px",
    whiteSpace: "pre",
    overflowX: "auto",
    tabSize: 4,
    fontSize: "13px",
    lineHeight: "20px",
    background: "transparent !important",
  },
  "& .line[data-highlight]": { display: "inline-block", width: "100%", background: "bg.muted" },
} as const;

/** The open tab's code: plain text at once, highlighted when the highlighter has it. */
function CodeBody<Value extends string>({ item }: { item: CodeTabItem<Value> }) {
  const { colorMode } = useColorMode();
  const [highlighted, setHighlighted] = useState<{ key: string; html: string } | null>(null);
  const key = `${colorMode}\u0000${item.language}\u0000${item.highlightLines?.join(",")}\u0000${item.code}`;

  useEffect(() => {
    let cancelled = false;
    const highlight = colorMode === "dark" ? codeToHtmlDark : codeToHtml;
    const marked = item.highlightLines;
    const lineData = marked
      ? (line: number) => (marked.includes(line) ? { highlight: "true" } : undefined)
      : undefined;
    void highlight({ code: item.code, lang: item.language, lineData }).then((html) => {
      if (!cancelled) setHighlighted({ key, html });
    });
    return () => {
      cancelled = true;
    };
  }, [item.code, item.language, item.highlightLines, colorMode, key]);

  const html = highlighted?.key === key ? highlighted.html : null;
  return (
    <Box overflow="auto" css={BODY_CSS}>
      {html ? (
        <Box display="contents" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>{item.code}</pre>
      )}
    </Box>
  );
}

/**
 * One code window whose header carries the language tabs and the copy action, over one shared
 * highlighted body. A single snippet that carries a key is `SnippetPreview`.
 */
export function CodeTabs<Value extends string>({
  items,
  value,
  copyLabel = "Copy code",
  ...props
}: CodeTabsProps<Value>) {
  const { copied, copy } = useCopyToClipboard();
  const open = items.find((item) => item.value === value);
  return (
    <TabsMachine
      {...props}
      value={value}
      look="code"
      mount="active"
      activationMode="automatic"
      actions={
        <IconButton
          size="2xs"
          variant="ghost"
          aria-label={copied ? "Copied" : copyLabel}
          disabled={!open}
          onClick={() => open && copy(open.code)}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </IconButton>
      }
      items={items.map((item) => ({
        value: item.value,
        testId: item.testId,
        trigger: item.label,
        panel: <CodeBody item={item} />,
      }))}
    />
  );
}

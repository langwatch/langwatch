import { Box, Button, Text, VisuallyHidden } from "@langwatch/design-system/primitives";
import { Check, Copy } from "lucide-react";
import { z } from "zod";

import { useCopy } from "../lib/clipboard.ts";

export type CodeSource = {
  lang: string;
  title: string;
  code: string;
  lines: string[];
  highlight: number[];
  numbered: boolean;
};

const LINE_HEIGHT = "22px";
const EXPAND_AFTER_LINES = 24;

export function sourceFromProps(props: Record<string, unknown>): CodeSource {
  const lines = z
    .array(z.string())
    .parse(JSON.parse(z.string().default("[]").parse(props["data-lines"])));
  return {
    lang: z.string().default("").parse(props["data-lang"]),
    title: z.string().default("").parse(props["data-title"]),
    code: z.string().default("").parse(props["data-code"]),
    lines,
    highlight: z
      .string()
      .default("")
      .parse(props["data-highlight"])
      .split(",")
      .filter(Boolean)
      .map(Number),
    numbered: z.string().default("").parse(props["data-flags"]).split(",").includes("lines"),
  };
}

export function CopyAction({ code, label = "Copy code" }: { code: string; label?: string }) {
  const { state, copy } = useCopy();
  return (
    <>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        colorPalette="gray"
        minHeight={{ base: "44px", md: "40px" }}
        minWidth={{ base: "44px", md: "40px" }}
        color="fg.muted"
        aria-label={state === "copied" ? "Copied" : label}
        onClick={() => copy({ text: code })}
      >
        {state === "copied" ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
        <Text as="span" fontSize="12px" display="none">
          {state === "copied" ? "Copied" : "Copy"}
        </Text>
      </Button>
      <VisuallyHidden as="output" aria-live="polite">
        {state === "copied"
          ? "Copied to clipboard"
          : state === "failed"
            ? "Could not copy. Select the code instead."
            : ""}
      </VisuallyHidden>
      {state === "failed" ? (
        <Text as="span" fontSize="12px" color="red.fg">
          Could not copy
        </Text>
      ) : null}
    </>
  );
}

/** The highlighted lines of one fence; both colour modes ride the same text via CSS variables. */
export function CodeBody({ source, expanded }: { source: CodeSource; expanded: boolean }) {
  const capped = source.lines.length > EXPAND_AFTER_LINES && !expanded;
  return (
    <Box
      as="pre"
      className="docs-code"
      data-numbered={source.numbered ? "true" : undefined}
      tabIndex={0}
      role="region"
      aria-label={`${source.title || source.lang || "Code"} source`}
      margin="0"
      padding="4"
      minWidth="0"
      maxWidth="100%"
      overflowX="auto"
      overflowY="auto"
      maxHeight={capped ? { base: "22rem", md: "33rem" } : undefined}
      fontFamily="mono"
      fontSize="14px"
      lineHeight={LINE_HEIGHT}
      tabSize={4}
      fontVariantLigatures="none"
      bg="transparent"
      color="fg"
    >
      <code>
        {source.lines.map((html, index) => (
          <span
            key={index}
            className="docs-line"
            data-highlighted={source.highlight.includes(index + 1) ? "true" : undefined}
            dangerouslySetInnerHTML={{ __html: html || "&#8203;" }}
          />
        ))}
      </code>
    </Box>
  );
}

export function ExpandControl({
  lines,
  expanded,
  onToggle,
}: {
  lines: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (lines <= EXPAND_AFTER_LINES) return null;
  return (
    <Box borderTopWidth="1px" borderColor="border.nested" paddingX="3" paddingY="1">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        colorPalette="gray"
        minHeight="40px"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        {expanded ? "Collapse code" : "Expand code"}
      </Button>
    </Box>
  );
}

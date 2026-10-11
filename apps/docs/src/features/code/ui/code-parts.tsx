import { Box, Button, Text, VisuallyHidden } from "@langwatch/design-system/primitives";
import { Check, Copy } from "lucide-react";
import { z } from "zod";

import type { CopyState } from "../../../lib/clipboard.ts";
import { useCopy } from "../../../lib/clipboard.ts";

export type CodeSource = {
  lang: string;
  title: string;
  code: string;
  lines: string[];
  highlight: number[];
  numbered: boolean;
};

const LINE_HEIGHT = "22px";

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

function copyAnnouncement({ state }: { state: CopyState }) {
  if (state === "copied") return "Copied to clipboard";
  if (state === "failed") return "Could not copy. Select the code instead.";
  return "";
}

export function CopyAction({
  code,
  label = "Copy code",
  hidden = false,
}: {
  code: string;
  label?: string;
  hidden?: boolean;
}) {
  const { state, copy, ready } = useCopy();
  return (
    <>
      <Button
        hidden={hidden}
        data-docs-copy={code}
        type="button"
        size="xs"
        variant="ghost"
        colorPalette="gray"
        minHeight={{ base: "44px", md: "40px" }}
        minWidth={{ base: "44px", md: "40px" }}
        color="fg.muted"
        aria-label={state === "copied" ? "Copied" : label}
        disabled={!ready}
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
        {copyAnnouncement({ state })}
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
export function CodeBody({ source }: { source: CodeSource }) {
  return (
    <Box
      as="section"
      className="docs-code-region"
      data-code={source.code}
      data-numbered={source.numbered ? "true" : undefined}
      tabIndex={0}
      aria-label={`${source.title || source.lang || "Code"} source`}
      margin="0"
      padding="4"
      minWidth="0"
      maxWidth="100%"
      overflowX="auto"
      fontFamily="mono"
      fontSize="14px"
      lineHeight={LINE_HEIGHT}
      tabSize={4}
      fontVariantLigatures="none"
      bg="transparent"
      color="fg"
    >
      <pre className="docs-code">
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
      </pre>
    </Box>
  );
}

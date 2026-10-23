import { Box, Flex, Text, VisuallyHidden } from "@langwatch/design-system/primitives";
import { Check, ChevronRight, Copy } from "lucide-react";
import type { ReactNode } from "react";

import { PROMPT_ATTRIBUTE } from "../../code/ui/copy-source.ts";
import { PROMPT_BODY_ATTRIBUTE } from "./prompt-attributes.ts";

function CopyIcons() {
  return (
    <>
      <Copy className="docs-skill-copy-idle" size={14} aria-hidden="true" />
      <Check className="docs-skill-copy-done" size={14} aria-hidden="true" />
    </>
  );
}

/** Narrow screens wrap a long command between path segments, never inside a hyphenated name. */
function wrappable({ value }: { value: string }): ReactNode[] {
  return value.split(/(?<=[/ ])/).map((segment, index) => (
    <span key={index} className="docs-skill-segment">
      {segment}
      <wbr />
    </span>
  ));
}

/** The install command is the block's main action: the whole line copies it. */
function InstallCommand({ install }: { install: string }) {
  return (
    <Flex className="docs-skill-command-cell" minWidth="0" flex="1">
      <button type="button" className="docs-skill-command" data-docs-copy={install}>
        <span className="docs-skill-glyph" aria-hidden="true" />
        {/* Named by its content: a label would not match the command as it wraps. */}
        <VisuallyHidden>Copy </VisuallyHidden>
        <Box as="code" flex="1" minWidth="0" textAlign="start">
          {wrappable({ value: install })}
        </Box>
        <CopyIcons />
      </button>
      <VisuallyHidden as="output" aria-live="polite" />
    </Flex>
  );
}

function PromptCopy({ prompt }: { prompt: string }) {
  return (
    <Flex className="docs-skill-prompt-cell" flexShrink="0">
      <button
        type="button"
        className="docs-skill-secondary"
        disabled
        data-docs-copy=""
        {...{ [PROMPT_ATTRIBUTE]: prompt }}
        aria-label="Copy full prompt"
      >
        <CopyIcons />
        <span className="docs-skill-label">
          <span className="docs-skill-label-idle">Copy full prompt</span>
          <span className="docs-skill-label-done">Copied</span>
        </span>
      </button>
      <VisuallyHidden as="output" aria-live="polite" />
    </Flex>
  );
}

function caption({ command }: { command: string }): ReactNode {
  if (!command) return "Paste the prompt into any coding agent.";
  return (
    <>
      Install once, then run <code>{command}</code> in your coding agent.
    </>
  );
}

export function SkillCard({
  title,
  install,
  command,
  prompt,
  children,
}: {
  title: string;
  install: string;
  command: string;
  prompt: string;
  children?: ReactNode;
}) {
  return (
    <Box className="docs-skill-card" data-install={install ? "true" : "false"}>
      <Box className="docs-skill-head">
        <Text as="h3" className="docs-skill-title">
          {title}
        </Text>
        <Text className="docs-skill-caption">{caption({ command })}</Text>
        {install || prompt ? (
          <Flex className="docs-skill-actions">
            {install ? <InstallCommand install={install} /> : null}
            {prompt ? <PromptCopy prompt={prompt} /> : null}
          </Flex>
        ) : null}
      </Box>
      {prompt ? (
        <details className="docs-skill-prompt">
          <summary>
            <ChevronRight size={14} aria-hidden="true" />
            <span>View prompt</span>
          </summary>
          <Box
            {...{ [PROMPT_BODY_ATTRIBUTE]: "" }}
            className="docs-skill-body docs-prose"
            fontSize="14px"
            lineHeight="24px"
            overflowWrap="anywhere"
          >
            {children}
          </Box>
        </details>
      ) : null}
    </Box>
  );
}

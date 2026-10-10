/**
 * The editor's API / MCP tab: how the member's own agent makes this widget instead. Unsaved,
 * a prompt that has the agent create it from scratch; saved, the calls that edit it by id.
 */

import { CopyButton } from "@langwatch/design-system/copy-button";
import { Box, HStack, Link, Spacer, Text, VStack } from "@langwatch/design-system/primitives";
import { ArrowUpRight } from "lucide-react";

import { WIDGET_AGENT_DOCS_URL, WIDGET_MCP_TOOL } from "../../model/widget-api.ts";

/** What the tab shows for a saved widget: its id, the REST call and the MCP tool call. */
export interface WidgetApiSnippets {
  readonly widgetId: string;
  readonly api: string;
  readonly mcp: string;
}

function CopyBlock({
  label,
  copied,
  text,
  wrap = false,
}: {
  label: string;
  copied: string;
  text: string;
  /** Prose wraps; code keeps its lines and scrolls. */
  wrap?: boolean;
}) {
  return (
    <VStack align="stretch" gap={1.5}>
      <HStack>
        <Text fontSize="12px" fontWeight="medium">
          {label}
        </Text>
        <Spacer />
        <CopyButton value={text} label={copied} aria-label={`Copy ${copied}`} size="xs" />
      </HStack>
      <Box
        as="pre"
        overflowX="auto"
        whiteSpace={wrap ? "pre-wrap" : "pre"}
        borderWidth="1px"
        borderColor="border"
        borderRadius="lg"
        background="bg.subtle"
        padding={3}
        fontFamily="mono"
        fontSize="11.5px"
        lineHeight="tall"
        color="fg.muted"
      >
        {text}
      </Box>
    </VStack>
  );
}

export function WidgetApiPanel({
  snippets,
  createPrompt,
}: {
  /** Null until the widget is saved and has an id. */
  snippets: WidgetApiSnippets | null;
  /** The prompt that has the member's agent create a widget on this board. */
  createPrompt: string;
}) {
  if (!snippets) {
    return (
      <VStack align="stretch" gap={4}>
        <VStack align="stretch" gap={1} fontSize="13px" color="fg.muted">
          <Text>Your own agent can build this widget from scratch, through our MCP server.</Text>
          <Text>Copy this prompt to your agent and say what the widget should show.</Text>
        </VStack>
        <CopyBlock label="Example prompt" copied="Prompt" text={createPrompt} wrap />
        {/* TODO: the page on creating widgets from an agent is not written yet, so this opens
            the MCP setup page; point it there once it exists. */}
        <Link
          href={WIDGET_AGENT_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          fontSize="13px"
          alignSelf="start"
        >
          Read the docs
          <ArrowUpRight size={13} aria-hidden />
        </Link>
      </VStack>
    );
  }
  return (
    <VStack align="stretch" gap={4}>
      <Text fontSize="13px" color="fg.muted">
        Your own agent can edit this widget by its id, through the LangWatch API or our MCP server.
      </Text>
      <CopyBlock label="Widget id" copied="Widget id" text={snippets.widgetId} />
      <CopyBlock label="API call" copied="API call" text={snippets.api} />
      <CopyBlock label={`MCP tool: ${WIDGET_MCP_TOOL}`} copied="MCP call" text={snippets.mcp} />
    </VStack>
  );
}

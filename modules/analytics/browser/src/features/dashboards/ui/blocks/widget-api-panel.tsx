/**
 * The editor's API / MCP tab: how the member's own agent makes the same edit, through the
 * LangWatch API or the MCP server, each ready to copy. A new widget has no id to edit yet.
 */

import { CopyButton } from "@langwatch/design-system/copy-button";
import { Box, HStack, Spacer, Text, VStack } from "@langwatch/design-system/primitives";

import { WIDGET_MCP_TOOL } from "../../model/widget-api.ts";

/** What the tab shows for a saved widget: its id, the REST call and the MCP tool call. */
export interface WidgetApiSnippets {
  readonly widgetId: string;
  readonly api: string;
  readonly mcp: string;
}

function CopyBlock({ label, copied, text }: { label: string; copied: string; text: string }) {
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
        whiteSpace="pre"
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

export function WidgetApiPanel({ snippets }: { snippets: WidgetApiSnippets | null }) {
  if (!snippets) {
    return (
      <Text fontSize="13px" color="fg.muted">
        Save the widget first. Then it has an id your agent can edit it by.
      </Text>
    );
  }
  return (
    <VStack align="stretch" gap={4}>
      <Text fontSize="13px" color="fg.muted">
        Let your own agent make this edit, through the LangWatch API or our MCP server.
      </Text>
      <CopyBlock label="Widget id" copied="Widget id" text={snippets.widgetId} />
      <CopyBlock label="API call" copied="API call" text={snippets.api} />
      <CopyBlock label={`MCP tool: ${WIDGET_MCP_TOOL}`} copied="MCP call" text={snippets.mcp} />
    </VStack>
  );
}

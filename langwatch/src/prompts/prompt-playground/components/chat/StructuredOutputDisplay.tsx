import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { RenderInputOutput } from "~/components/traces/RenderInputOutput";

interface StructuredOutputDisplayProps {
  /** The raw content from the assistant message */
  content: string | undefined;
  /** Whether the message is still streaming */
  isStreaming: boolean;
  /** Fallback children to render while streaming or for non-JSON content */
  children: ReactNode;
}

/**
 * Attempts to parse a string as JSON.
 * Returns the parsed object if successful, undefined otherwise.
 */
export function tryParseJson(content: string | undefined): object | undefined {
  if (!content || typeof content !== "string") {
    return undefined;
  }

  const trimmed = content.trim();
  // Quick check: must start with { to be a JSON object
  if (!trimmed.startsWith("{")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    // Only accept objects, not arrays or primitives
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Renders JSON data using the same style as trace details panel.
 */
function JsonTreeView({ data }: { data: object }) {
  return (
    <Box
      as="pre"
      borderRadius="6px"
      padding={4}
      borderWidth="1px"
      borderColor="gray.300"
      width="full"
      whiteSpace="pre-wrap"
    >
      <RenderInputOutput value={data} showTools />
    </Box>
  );
}

/**
 * StructuredOutputDisplay
 *
 * Wraps assistant messages and detects if the content is JSON.
 * When streaming is complete and content is valid JSON, renders it
 * using the same JSON tree view as trace details. Otherwise, renders
 * the fallback children.
 */
export function StructuredOutputDisplay({
  content,
  isStreaming,
  children,
}: StructuredOutputDisplayProps) {
  // While streaming, always show the regular message
  if (isStreaming) {
    return <>{children}</>;
  }

  // Try to parse as JSON
  const jsonData = tryParseJson(content);

  // If valid JSON, render as JSON tree view (same as trace details)
  if (jsonData) {
    return <JsonTreeView data={jsonData} />;
  }

  // Otherwise, render the fallback
  return <>{children}</>;
}

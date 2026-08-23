/**
 * The shared rig for the `ConversationThread` suites.
 *
 * The suites split by what they answer for — what a message shows, and what
 * the thread around it does — but they render the same component the same way,
 * so the rendering lives here rather than being copied. The `vi.mock` calls
 * cannot: they are hoisted per file and each suite declares the ones it needs.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { ConversationThread } from "../ConversationThread";
import { type FlattenableMessage, flattenMessages } from "../flattenMessages";

export const message = (msg: Record<string, unknown>) =>
  msg as FlattenableMessage;

/**
 * The playground's own configuration, so these tests answer for the surface
 * the spec is about: `PromptPlaygroundChat` renders `ConversationThread` with
 * `structuredOutput` on, the default `regular` variant (turn separators on)
 * and the default autoScroll, and adds nothing else.
 */
export function renderConversation(
  messages: Record<string, unknown>[],
  options: {
    structuredOutput?: boolean;
    labels?: { user?: string; assistant?: string };
    roleMode?: "chat" | "scenario";
  } = {},
): ReturnType<typeof render> {
  const ui: ReactElement = (
    <ConversationThread
      parts={flattenMessages({ messages: messages.map(message) })}
      projectId="proj-1"
      structuredOutput={options.structuredOutput ?? true}
      labels={options.labels}
      roleMode={options.roleMode ?? "chat"}
    />
  );
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

/** The trace behind a turn has landed and can be opened. */
export const traceLanded = () => ({
  data: { trace_id: "trace-1" },
  isError: false,
});
/** The trace has not been written yet — the query is still retrying. */
export const traceNotYetLanded = () => ({ data: undefined, isError: false });
/** The trace will never arrive: it expired, or was never written. */
export const traceGone = () => ({ data: undefined, isError: true });

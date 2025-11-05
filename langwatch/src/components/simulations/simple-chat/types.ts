import type {
  Message,
  TextMessage,
  ActionExecutionMessage,
  ResultMessage,
  Role,
} from "@copilotkit/runtime-client-gql";

/**
 * Extends CopilotKit Message with optional trace ID
 * Single Responsibility: Type definition for chat messages
 */
export type ChatMessage = Message & { traceId?: string };

/**
 * Discriminated union for typed message handling
 * Single Responsibility: Provide type-safe message variants
 */
export type TypedChatMessage =
  | { type: "text"; message: TextMessage & { traceId?: string } }
  | { type: "action"; message: ActionExecutionMessage }
  | { type: "result"; message: ResultMessage };

/**
 * Props for message rendering components
 * Single Responsibility: Define component interface contracts
 */
export interface MessageViewerProps {
  messages: ChatMessage[];
  smallerView?: boolean;
}

export interface MessageItemProps {
  message: ChatMessage;
  smallerView?: boolean;
}

export { Role };

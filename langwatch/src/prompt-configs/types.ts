import type { Target } from "./utils/generatePromptApiSnippet";

/**
 * Represents a code snippet for API usage
 */
export type Snippet = {
  /** The actual code content of the snippet */
  content: string;
  /** The programming language/framework target of the snippet */
  target: Target;
  /** Human-readable title for the snippet */
  title: string;
};

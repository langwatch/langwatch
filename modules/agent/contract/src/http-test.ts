/** One turn of the conversation an HTTP agent test sends as `{{messages}}`. */
export type TestMessage = {
  role: "user" | "assistant";
  content: string;
};

/** Renders the built messages into the JSON string the body template reads. */
export function messagesToJson(messages: TestMessage[]): string {
  return JSON.stringify(messages.map((m) => ({ role: m.role, content: m.content })));
}

export type HttpTestResult = {
  success: boolean;
  response?: unknown;
  extractedOutput?: string;
  error?: string;
  /** The engine's stable failure code, which names the copy for it. */
  errorCode?: string;
  status?: number;
  statusText?: string;
  duration?: number;
  responseHeaders?: Record<string, string>;
  /** The body the engine rendered and sent, as opposed to the local preview. */
  renderedBody?: string;
  /** Variables the template referenced that the test did not supply. */
  warnings?: string[];
};

export type HttpTestErrorExplanation = (input: { errorCode?: string; error?: string }) => {
  title: string;
  description?: string;
};

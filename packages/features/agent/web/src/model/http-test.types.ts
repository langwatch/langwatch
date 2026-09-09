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

export type HttpTestErrorExplanationPort = (input: { errorCode?: string; error?: string }) => {
  title: string;
  description?: string;
};

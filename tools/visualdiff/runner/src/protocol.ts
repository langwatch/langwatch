/**
 * The wire between the Go orchestrator and this package: a plan in, JSON lines
 * out. Prose goes to stderr, so stdout never has to tell the two apart.
 */

export interface Viewport {
  width: number;
  height: number;
}

export interface SettleConfig {
  quietMillis: number;
  deadlineMillis: number;
}

export interface PlanStep {
  action: string;
  label?: string;
  optional?: boolean;
  with?: Record<string, string>;
}

export interface PlanFlow {
  id: string;
  title: string;
  steps: PlanStep[];
}

export interface PlanSide {
  name: string;
  baseUrl: string;
}

export interface Credential {
  projectKey: string;
  email: string;
  password: string;
  slug: string;
}

export interface Plan {
  viewport: Viewport;
  settle: SettleConfig;
  sides: PlanSide[];
  outDir: string;
  slug: string;
  routes: string[];
  flows: PlanFlow[];
  credential: Credential;
}

export interface CaptureMessage {
  type: "capture";
  kind: "route" | "flow";
  key: string;
  index: number;
  label: string;
  side: string;
  url: string;
  screenshot: string;
  consoleErrors: string[];
  failedRequests: string[];
  notFound: boolean;
  error: string;
  durationMs: number;
}

export interface DiffMessage {
  type: "diff";
  kind: "route" | "flow";
  key: string;
  index: number;
  ratio: number;
  file: string;
}

export type Message =
  | CaptureMessage
  | DiffMessage
  | { type: "ready" }
  | { type: "done" }
  | { type: "log"; message: string }
  | { type: "error"; message: string };

/** emit writes one protocol message. Never call console.log elsewhere. */
export const emit = ({ message, out }: { message: Message; out: NodeJS.WritableStream }): void => {
  out.write(`${JSON.stringify(message)}\n`);
};

/** note writes progress for a person, on stderr, where it cannot corrupt the protocol. */
export const note = ({ text, err }: { text: string; err: NodeJS.WritableStream }): void => {
  err.write(`${text}\n`);
};

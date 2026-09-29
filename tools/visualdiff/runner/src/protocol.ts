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
  /** isolated runs the flow in the seeded second project. */
  isolated?: boolean;
  /** serial runs the flow alone, after every other flow. */
  serial?: boolean;
  steps: PlanStep[];
}

export interface PlanSide {
  name: string;
  baseUrl: string;
  /** replay names a cached captures.jsonl this side is read from instead of rendered. */
  replay?: string;
  /** pending names the file this side's address arrives in once its stack is up. */
  pending?: string;
  /** mailUrl is this side's mail sink (services/mailsim), where its stack has one. */
  mailUrl?: string;
  /** fixtures are the ids this side's seed generated; they win over the plan's. */
  fixtures?: Record<string, string>;
  /** staticDir holds this side's prebuilt UI; absent, the side is captured from its dev server. */
  staticDir?: string;
}

export interface Credential {
  projectKey: string;
  email: string;
  password: string;
  slug: string;
  /** fallbackEmails are tried in order when email does not sign in on a side. */
  fallbackEmails?: string[];
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
  /** failFast aborts once the candidate's first routes show its shell does not render. */
  failFast?: boolean;
  /** frozenTime is the Date.now() every page sees, so relative times render alike on both sides. */
  frozenTime?: number;
  /** fixtures fill a route's {name} placeholders with seeded ids. */
  fixtures?: Record<string, string>;
  /** concurrency is how many pages each side captures routes and flows on at once. */
  concurrency?: Concurrency;
  /** check photographs a flow only at its expects and its failure, and times each flow. */
  check?: boolean;
}

export interface Concurrency {
  routes?: number;
  flows?: number;
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
  /** moduleFailures are the page's own modules that failed to load, the tool's failure. */
  moduleFailures?: string[];
  notFound: boolean;
  blank: boolean;
  /** ariaSnapshot is the page's accessibility tree as YAML, the screen's text evidence. */
  ariaSnapshot: string;
  error: string;
  durationMs: number;
  /** expect is an expect step's one-line proof (flows/expect.ts), passing or failing. */
  expect?: string;
}

export interface DiffMessage {
  type: "diff";
  kind: "route" | "flow";
  key: string;
  index: number;
  ratio: number;
  file: string;
}

/** PhaseMessage is how long one side spent in one phase of its capture. */
export interface PhaseMessage {
  type: "phase";
  side: string;
  /** A `flow <id>` phase is one flow's whole walk, reported in check mode only. */
  name: "capture" | "recapture" | "flows" | "sign-in" | `flow ${string}`;
  millis: number;
}

export type Message =
  | CaptureMessage
  | DiffMessage
  | { type: "ready" }
  | { type: "done" }
  | { type: "log"; message: string }
  | PhaseMessage
  | { type: "error"; message: string };

/** emit writes one protocol message. Never call console.log elsewhere. */
export const emit = ({ message, out }: { message: Message; out: NodeJS.WritableStream }): void => {
  out.write(`${JSON.stringify(message)}\n`);
};

/** note writes progress for a person, on stderr, where it cannot corrupt the protocol. */
export const note = ({ text, err }: { text: string; err: NodeJS.WritableStream }): void => {
  err.write(`${text}\n`);
};

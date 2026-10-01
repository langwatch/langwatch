import type { Page, Request } from "playwright";

/**
 * What the workbench page did with the turn's `ui` entries, read off its own network:
 * the claim and completion calls its Langy panel makes. The stream the adapter reads
 * says what was dispatched; the page's calls say what became of it.
 */
import type { UiActionExecution } from "../../src/shell/model/langy/ui-actions/execute-ui-action.ts";
import type { UiActionEntry } from "./langy-agent";

/** One `ui` entry the turn stream carried, and what the page made of it. */
export interface ObservedAction {
  actionId: string;
  kind: string;
  payload: unknown;
  /** The outcome `executeUiAction` reached, as the page's calls show it. */
  outcome: UiActionExecution;
  /** What the page reported back, when it reported anything. */
  ok?: boolean;
  result?: unknown;
  errorCode?: string;
  /** When the entry arrived on the turn stream. */
  seenAtMs: number;
  /** When the page finished with it. */
  settledAtMs: number;
}

interface TrackedAction {
  actionId: string;
  kind: string;
  payload: unknown;
  seenAtMs: number;
  claim?: { isClaimed: boolean; atMs: number };
  complete?: {
    ok: boolean;
    result?: unknown;
    errorCode?: string;
    isAccepted: boolean;
    atMs: number;
  };
}

interface TrpcCall {
  path: string;
  input: unknown;
  output: unknown;
}

const CLAIM_PATH = "langy.claimUiAction";
const COMPLETE_PATH = "langy.completeUiAction";

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/** The browser client sends bare JSON; the suite's own helper wraps it in `json`. */
function unwrap(value: unknown): unknown {
  return typeof value === "object" && value !== null && "json" in value
    ? field(value, "json")
    : value;
}

/** Every call one tRPC request carried: a batch joins its paths and indexes its bodies. */
function callsOf({ url, body, reply }: { url: string; body: unknown; reply: unknown }): TrpcCall[] {
  const { pathname, searchParams } = new URL(url);
  const isBatch = searchParams.get("batch") === "1";
  const paths = decodeURIComponent(pathname.slice("/api/trpc/".length)).split(",");
  return paths.map((path, index) => {
    const replied = isBatch && Array.isArray(reply) ? reply[index] : reply;
    return {
      path,
      input: unwrap(isBatch ? field(body, String(index)) : body),
      output: unwrap(field(field(replied, "result"), "data")),
    };
  });
}

async function replyOf(request: Request): Promise<unknown> {
  const response = await request.response();
  return response ? response.json().catch(() => undefined) : undefined;
}

function outcomeOf(action: TrackedAction): UiActionExecution {
  if (!action.claim) return "no-handler";
  if (!action.claim.isClaimed) return "not-claimed";
  if (!action.complete) return "completion-failed";
  if (!action.complete.ok) return "handler-failed";
  return action.complete.isAccepted ? "executed" : "completion-failed";
}

function observed(action: TrackedAction): ObservedAction {
  return {
    actionId: action.actionId,
    kind: action.kind,
    payload: action.payload,
    outcome: outcomeOf(action),
    ok: action.complete?.ok,
    result: action.complete?.result,
    errorCode: action.complete?.errorCode,
    seenAtMs: action.seenAtMs,
    settledAtMs: action.complete?.atMs ?? action.claim?.atMs ?? action.seenAtMs,
  };
}

const CLAIMED_OUTCOMES: readonly UiActionExecution[] = [
  "executed",
  "handler-failed",
  "completion-failed",
];

function trackedFor(actions: Map<string, TrackedAction>, actionId: string): TrackedAction {
  const known = actions.get(actionId);
  if (known) return known;
  const unseen: TrackedAction = { actionId, kind: "unknown", payload: undefined, seenAtMs: 0 };
  actions.set(actionId, unseen);
  return unseen;
}

function recordCall({
  actions,
  call,
  atMs,
}: {
  actions: Map<string, TrackedAction>;
  call: TrpcCall;
  atMs: number;
}): void {
  const actionId = field(call.input, "actionId");
  if (typeof actionId !== "string") return;
  const action = trackedFor(actions, actionId);
  if (call.path === CLAIM_PATH) {
    action.claim = { isClaimed: field(call.output, "isClaimed") === true, atMs };
    return;
  }
  const errorCode = field(call.input, "errorCode");
  action.complete = {
    ok: field(call.input, "ok") === true,
    result: field(call.input, "result"),
    ...(typeof errorCode === "string" ? { errorCode } : {}),
    isAccepted: field(call.output, "isAccepted") === true,
    atMs,
  };
}

async function readRequest({
  actions,
  request,
}: {
  actions: Map<string, TrackedAction>;
  request: Request;
}): Promise<void> {
  const url = request.url();
  if (!url.includes(CLAIM_PATH) && !url.includes(COMPLETE_PATH)) return;
  const atMs = Date.now();
  const calls = callsOf({ url, body: request.postDataJSON(), reply: await replyOf(request) });
  for (const call of calls) {
    if (call.path === CLAIM_PATH || call.path === COMPLETE_PATH)
      recordCall({ actions, call, atMs });
  }
}

/** The page's action record, fed by the turn stream and by the page's own calls. */
export interface PageActionLog {
  /** The adapter's hook: an entry the turn stream carried. */
  onStreamEntry: (entry: UiActionEntry) => void;
  seenActions: () => { actionId: string; kind: string }[];
  claimedActions: () => ObservedAction[];
  droppedActions: () => ObservedAction[];
  /** Waits for every call the page has made so far to be read. */
  settle: () => Promise<void>;
}

export function watchPageUiActions(page: Page): PageActionLog {
  const actions = new Map<string, TrackedAction>();
  const pending = new Set<Promise<void>>();

  const onRequest = (request: Request): void => {
    const read = readRequest({ actions, request }).catch((error: unknown) =>
      console.log(`[workbench-page] could not read ${request.url()}: ${String(error)}`),
    );
    pending.add(read);
    void read.finally(() => pending.delete(read));
  };
  page.on("requestfinished", onRequest);
  page.on("requestfailed", onRequest);

  const settledActions = () => [...actions.values()].map(observed);

  return {
    onStreamEntry: (entry) => {
      const action = trackedFor(actions, entry.actionId);
      action.kind = entry.kind;
      action.payload = entry.payload;
      action.seenAtMs = Date.now();
    },
    seenActions: () =>
      [...actions.values()]
        .filter((action) => action.seenAtMs > 0)
        .map(({ actionId, kind }) => ({ actionId, kind })),
    claimedActions: () =>
      settledActions().filter((action) => CLAIMED_OUTCOMES.includes(action.outcome)),
    droppedActions: () =>
      settledActions().filter((action) => !CLAIMED_OUTCOMES.includes(action.outcome)),
    settle: async () => {
      while (pending.size > 0) await Promise.allSettled(pending);
    },
  };
}

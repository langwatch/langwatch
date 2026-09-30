import { isModuleConsoleError, isModuleRequest } from "@langwatch/visual-diff-runner/module-load";
import { shouldIgnoreRequest } from "@langwatch/visual-diff-runner/settle";

export const FINDING_KINDS = [
  "page-error",
  "console-error",
  "server-error",
  "client-error",
  "request-failed",
  "error-boundary",
  "blank-screen",
  "not-found",
  "hang",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export type RawEvent =
  | { type: "pageerror"; message: string }
  | { type: "console"; text: string; url: string }
  | { type: "response"; status: number; method: string; url: string; resourceType: string }
  | { type: "requestfailed"; method: string; url: string; error: string; resourceType: string };

/** Draft is what an oracle says about one event, before a trail and a screenshot are added. */
export interface Draft {
  kind: FindingKind;
  message: string;
  signature: string;
}

/** Auth refusals are the product working: a signed-out call, or a role that lacks the right. */
const EXPECTED_AUTH_STATUSES = new Set([401, 403]);

const ID_SEGMENT =
  /\/(?:[0-9a-f]{8}-[0-9a-f-]{27}|[A-Za-z]+_[A-Za-z0-9]{8,}|c[a-z0-9]{20,}|\d{2,})(?=\/|$)/g;

/** normalisePath drops the query and every id, so one cause is one signature. */
export const normalisePath = (raw: string): string => {
  let path = raw;
  try {
    path = new URL(raw, "http://x").pathname;
  } catch {
    path = raw.split("?")[0] ?? raw;
  }
  return path.replaceAll(ID_SEGMENT, "/:id");
};

/** normaliseMessage strips the numbers and ids that make one error text look like many. */
export const normaliseMessage = (text: string): string =>
  (text.split("\n")[0] ?? "")
    .replaceAll(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/g, "<uuid>")
    .replaceAll(/\b[A-Za-z]*_?[A-Za-z0-9]{20,}\b/g, "<id>")
    .replaceAll(/\d+/g, "N")
    .slice(0, 160);

const sameOrigin = ({ url, origin }: { url: string; origin: string }): boolean => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

/** Dev-server chatter that says nothing about the product: hot-reload sockets and their retries. */
const DEV_SERVER_NOISE = /\[vite\]|WebSocket connection to|Vite server|ERR_HTTP2/;

const classifyConsole = (text: string): Draft | undefined => {
  if (DEV_SERVER_NOISE.test(text)) return undefined;
  // The browser's own "Failed to load resource" line duplicates the response oracle.
  if (text.startsWith("Failed to load resource")) return undefined;
  return {
    kind: "console-error",
    message: text.slice(0, 500),
    signature: `console-error ${normaliseMessage(text)}`,
  };
};

const classifyResponse = ({
  event,
  origin,
}: {
  event: Extract<RawEvent, { type: "response" }>;
  origin: string;
}): Draft | undefined => {
  const { status, method, url, resourceType } = event;
  if (isModuleRequest({ url, resourceType, origin })) return undefined;
  if (status < 400 || !sameOrigin({ url, origin })) return undefined;
  if (shouldIgnoreRequest({ url, resourceType })) return undefined;
  if (EXPECTED_AUTH_STATUSES.has(status) || status === 429) return undefined;
  const kind = status >= 500 ? "server-error" : "client-error";
  return {
    kind,
    message: `${status} ${method} ${url.replace(origin, "").slice(0, 200)}`,
    signature: `${kind} ${status} ${method} ${normalisePath(url)}`,
  };
};

const classifyFailedRequest = ({
  event,
  origin,
}: {
  event: Extract<RawEvent, { type: "requestfailed" }>;
  origin: string;
}): Draft | undefined => {
  const { method, url, error, resourceType } = event;
  if (isModuleRequest({ url, resourceType, origin })) return undefined;
  if (!sameOrigin({ url, origin }) || shouldIgnoreRequest({ url, resourceType })) return undefined;
  if (/ERR_ABORTED/.test(error)) return undefined;
  return {
    kind: "request-failed",
    message: `FAIL ${method} ${url.replace(origin, "").slice(0, 200)} ${error}`,
    signature: `request-failed ${method} ${normalisePath(url)} ${error}`,
  };
};

/** classifyEvent is the oracle for what the page itself reported: an error, or a failed call. */
export const classifyEvent = ({
  event,
  origin,
}: {
  event: RawEvent;
  origin: string;
}): Draft | undefined => {
  switch (event.type) {
    case "pageerror":
      return {
        kind: "page-error",
        message: event.message,
        signature: `page-error ${normaliseMessage(event.message)}`,
      };
    case "console":
      return classifyConsole(event.text);
    case "response":
      return classifyResponse({ event, origin });
    case "requestfailed":
      return classifyFailedRequest({ event, origin });
  }
};

/** moduleFailed is a step in which one of the page's own modules did not load. */
const moduleFailed = ({
  events,
  origin,
}: {
  events: readonly RawEvent[];
  origin: string;
}): boolean =>
  events.some((event) => {
    if (event.type === "pageerror") return isModuleConsoleError(event.message);
    if (event.type === "console") return isModuleConsoleError(event.text);
    if (event.type === "requestfailed") return isModuleRequest({ ...event, origin });
    return event.status >= 400 && isModuleRequest({ ...event, origin });
  });

/**
 * classifyStep is every draft one step's events make. When a module failed to load, the page's
 * own errors and its blank screen are that failure's consequences, so they are not findings:
 * it is the stack under load, not the product, and the caller counts it apart.
 */
export const classifyStep = ({
  events,
  origin,
}: {
  events: readonly RawEvent[];
  origin: string;
}): { drafts: Draft[]; moduleFailure: boolean } => {
  const moduleFailure = moduleFailed({ events, origin });
  const drafts = events.flatMap((event) => classifyEvent({ event, origin }) ?? []);
  const kept = moduleFailure
    ? drafts.filter((draft) => draft.kind !== "console-error" && draft.kind !== "page-error")
    : drafts;
  return { drafts: kept, moduleFailure };
};

const BOUNDARY_TEXT =
  /something went wrong|unexpected application error|application error|error boundary|this page crashed/i;

/** classifyScreen is the oracle for what the page shows: blank, crashed, or a not-found page. */
export const classifyScreen = ({
  text,
  url,
  origin,
}: {
  text: string;
  url: string;
  origin: string;
}): Draft | undefined => {
  const path = normalisePath(url);
  if (!sameOrigin({ url, origin })) return undefined;
  if (text.trim() === "") {
    return {
      kind: "blank-screen",
      message: `no text at ${path}`,
      signature: `blank-screen ${path}`,
    };
  }
  const head = text.slice(0, 400);
  if (/page not found|404/i.test(head)) {
    return { kind: "not-found", message: `not found at ${path}`, signature: `not-found ${path}` };
  }
  if (BOUNDARY_TEXT.test(text.slice(0, 2000))) {
    return {
      kind: "error-boundary",
      message: `error screen at ${path}: ${normaliseMessage(head.trim())}`,
      signature: `error-boundary ${path}`,
    };
  }
  return undefined;
};

/** classifyHang names an action that never finished or a route that never stopped loading. */
export const classifyHang = ({ what, url }: { what: string; url: string }): Draft => ({
  kind: "hang",
  message: `${what} at ${url}`,
  signature: `hang ${what.split(" ")[0]} ${normalisePath(url)}`,
});

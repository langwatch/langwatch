/**
 * The Navigation capability (record 10.1): the address bar, leaving the
 * application, a stale chunk after a deploy, and an API that has not answered.
 */

import { nowInstant } from "@langwatch/time";
import {
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type LazyExoticComponent,
} from "react";
import {
  createBrowserRouter,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
  type NavigateFunction,
  type RouteObject,
} from "react-router";

import { UiNavigation, UiRoute, type UiRouteReadingValues } from "./capabilities.ts";
import { importChunkAgain } from "./chunk-refetch.ts";

/**
 * A failure that never reached the server — not a refusal, not a bug. A
 * false positive is worse than a false negative, so this only counts as
 * unreachable with BOTH marks: a known transport message, and no response.
 */

/** What each engine says when a fetch never completed. */
const TRANSPORT_FAILURES = [
  "failed to fetch", // Chromium
  "networkerror when attempting to fetch resource", // Firefox
  "load failed", // Safari
  "network request failed",
  "fetch failed", // undici, on the server side of a proxy hop
  "the network connection was lost",
  "err_connection_refused",
  "err_network_changed",
];

/**
 * What an intermediary returns when it got no answer from us: a proxy in
 * front of a rolling deploy (haven locally, an ingress in prod) answers
 * 502/503/504 with an empty body — "nothing answered" wearing a status.
 */
const NO_UPSTREAM_STATUSES = [502, 503, 504];

/**
 * Whether this failure never got an answer — also true when the browser
 * itself says it is offline, the one case we can be certain about without
 * inspecting anything.
 */
export function isServerUnreachable(error: unknown): boolean {
  if (!error) return false;

  // A server that answered is reachable, whatever the browser thinks of the
  // network — this must run before the `onLine` shortcut below, because
  // `onLine` reads false while HTTP still works on some headless and
  // containerised browsers, which would otherwise repaint a named refusal.
  if (carriesAResponse(error)) return false;

  // Below `carriesAResponse` on purpose: our own upstream failures use these
  // same statuses AND carry a code, so they are already gone by here. What is
  // left is a gateway status with no answer attached, sent by an intermediary.
  const status = responseStatusOf(error);
  if (status !== null && NO_UPSTREAM_STATUSES.includes(status)) return true;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }

  const message = messageOf(error);
  if (!message) return false;
  if (!TRANSPORT_FAILURES.some((phrase) => message.includes(phrase))) {
    return false;
  }

  return true;
}

function messageOf(error: unknown): string | null {
  if (typeof error === "string") return error.toLowerCase();
  if (error instanceof Error) return error.message.toLowerCase();
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message?: unknown };
    return typeof message === "string" ? message.toLowerCase() : null;
  }
  return null;
}

/**
 * The raw reply's status when it arrived without a tRPC envelope: `data` is
 * where tRPC puts a parsed answer, so an empty 502 has none, and this reads
 * the Response the link hangs off `meta` instead (`@trpc/client` 11).
 */
function responseStatusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const { meta } = error as { meta?: unknown };
  if (!meta || typeof meta !== "object") return null;
  const { response } = meta as { response?: unknown };
  if (!response || typeof response !== "object") return null;
  const { status } = response as { status?: unknown };
  return typeof status === "number" ? status : null;
}

function carriesAResponse(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { data } = error as { data?: unknown };
  if (typeof data !== "object" || data === null) return false;
  const { httpStatus, code } = data as {
    httpStatus?: unknown;
    code?: unknown;
  };
  return typeof httpStatus === "number" || typeof code === "string";
}

/**
 * Leaving this application, which the router cannot do — the GitHub
 * ceremonies leave via full page load. `noopener,noreferrer` matters:
 * without it the new tab holds a live `window.opener` back into this one.
 */

/**
 * Whether a full-page navigation was asked for and the next document hasn't arrived yet. The
 * browser gives no signal for this, so an in-flight request the unload aborted looks identical
 * to a real failure — telling someone their sign-up broke moments before the next page arrives.
 */
let navigatingAway = false;

export function isUiNavigatingAway(): boolean {
  return navigatingAway;
}

/** Replaces this document with another address, in this tab. */
export function uiLeaveTo(url: string): void {
  navigatingAway = true;
  window.location.href = url;
}

/** Opens an address this application does not serve in a new tab. */
export function uiOpenExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Loading code-split chunks on a link that drops requests and across deploys that remove
 * them: every route, screen, host, drawer and lent loader goes through `loadChunk`.
 * Spec: specs/navigation/chunk-load-retry.feature
 */

const RELOAD_COOLDOWN_MS = 10_000;
export const RELOAD_AT_KEY = "chunk-reload-at";

/** The waits before each retry of a chunk that did not load. */
export const CHUNK_RETRY_DELAYS_MS: readonly number[] = [500, 1_000, 2_000];

/** How long the "is this chunk gone?" probe may take before it counts as no answer. */
const DEPLOY_PROBE_TIMEOUT_MS = 5_000;

function chunkErrorMessageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

export function isChunkLoadError(err: unknown): boolean {
  const msg = chunkErrorMessageOf(err).toLowerCase();
  return (
    msg.includes("loading chunk") ||
    msg.includes("dynamically imported module") ||
    msg.includes("importing a module script failed") ||
    msg.includes("unable to preload css")
  );
}

/** Whether a failure, or any failure it wraps as its `cause`, is a chunk that did not load. */
export function isChunkLoadFailure(err: unknown): boolean {
  for (let at = err, depth = 0; at !== undefined && depth < 5; depth++) {
    if (isChunkLoadError(at)) return true;
    at = at instanceof Error ? at.cause : void 0;
  }
  return false;
}

/** The script a chunk failure names, when the engine names one (Chrome and Firefox do). */
export function chunkUrlOf(err: unknown): string | undefined {
  const named = /(\S+\.m?js)(?:\?\S*)?$/.exec(chunkErrorMessageOf(err).trim())?.[1];
  if (named === undefined) return void 0;
  try {
    return new URL(named, window.location.href).href;
  } catch {
    return void 0;
  }
}

export function forceReloadOnce(): boolean {
  if (typeof window === "undefined") return false;

  const lastReloadAt = Number(sessionStorage.getItem(RELOAD_AT_KEY) ?? "0");
  if (nowInstant().epochMilliseconds - lastReloadAt <= RELOAD_COOLDOWN_MS) return false;

  sessionStorage.setItem(RELOAD_AT_KEY, String(nowInstant().epochMilliseconds));
  window.location.reload();
  return true;
}

/**
 * Reloads once when the server answers that the failed chunk is gone (a deploy replaced it).
 * A reload on a dropped connection lands on the browser's own error page, so no answer from
 * the server means no reload.
 */
async function reloadIfDeployRemoved(err: unknown): Promise<boolean> {
  const url = chunkUrlOf(err);
  if (url === undefined) return false;
  try {
    const probe = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      signal: AbortSignal.timeout(DEPLOY_PROBE_TIMEOUT_MS),
    });
    return probe.status === 404 && forceReloadOnce();
  } catch {
    return false;
  }
}

/** Failures a caller already owns, so the `vite:preloadError` listener leaves them alone. */
const ownedFailures = new WeakSet<object>();

function ownFailure(error: unknown): void {
  if (typeof error === "object" && error !== null) ownedFailures.add(error);
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Loads a chunk, retrying after each wait in `delaysMs` while the failure is a chunk that
 * did not load. A browser may remember a failed `import()` and reject the same address at
 * once, so a retry asks for the address the failure named under a fresh query.
 */
export async function loadChunk<T>(
  load: () => Promise<T>,
  { delaysMs = CHUNK_RETRY_DELAYS_MS, wait = waitMs } = {},
): Promise<T> {
  let failure: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    if (attempt > 0) await wait(delaysMs[attempt - 1] ?? 0);
    const url = attempt === 0 ? void 0 : chunkUrlOf(failure);
    try {
      return await (url === void 0 ? load() : importChunkAgain<T>({ url, attempt }));
    } catch (error) {
      ownFailure(error);
      if (!isChunkLoadError(error)) throw error;
      failure = error;
    }
  }
  await reloadIfDeployRemoved(failure);
  throw failure;
}

/** `React.lazy` over `loadChunk`: a code-split component that survives a dropped request. */
export function lazyChunk<Component extends ComponentType<never>>(
  load: () => Promise<{ default: Component }>,
): LazyExoticComponent<Component> {
  return lazy(() => loadChunk(load));
}

export async function warmChunk(load: () => Promise<unknown>): Promise<boolean> {
  try {
    await load();
    return true;
  } catch (error) {
    ownFailure(error);
    return false;
  }
}

/**
 * Vite reports a failed chunk here before it rejects. Never `preventDefault`: Vite then
 * RESOLVES the import with `undefined`, and the loader reads `.default` of nothing. A failure
 * no loader owns (a bare `import()`) reloads only when the chunk is confirmed gone.
 */
export function registerChunkReloadListener(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    const payload = "payload" in event ? event.payload : void 0;
    // The loader's own catch runs in a microtask after this event, so look after it.
    setTimeout(() => {
      const owned = typeof payload === "object" && payload !== null && ownedFailures.has(payload);
      if (!owned) void reloadIfDeployRemoved(payload);
    }, 0);
  });
}

/**
 * Wraps a dynamic `import()` for React Router's `lazy`, which keeps the OLD
 * route visible while the new module loads (no gray flash). A chunk that will
 * not load is retried; what still fails falls to the boundary.
 */
export type LazyRouteModule = { default: ComponentType };

export function lazyRoute(load: () => Promise<LazyRouteModule>): {
  lazy: () => Promise<{ Component: ComponentType }>;
} {
  return {
    lazy: () => loadChunk(load).then((module) => ({ Component: module.default })),
  };
}

/**
 * Telling "the API did not answer" apart from "the API refused".
 * Spec: specs/ui/api-boot-wait.feature
 */

/** The API's own liveness route, which answers 204 with no session of any kind. */
export const UI_API_HEALTH_PATH = "/api/health";

/** The first retry is quick, because a local API is usually seconds away. */
export const UI_API_POLL_FIRST_DELAY_MS = 500;
/** The ceiling, so a stack that is minutes away is not polled at boot speed. */
export const UI_API_POLL_MAX_DELAY_MS = 3_000;
/** After this long the wait stops being a boot and is worth explaining. */
export const UI_API_WAIT_HINT_AFTER_MS = 60_000;

/** The next wait, easing off the API rather than hammering it. */
export function nextUiApiPollDelay(previous: number): number {
  return Math.min(Math.round(previous * 1.5), UI_API_POLL_MAX_DELAY_MS);
}

function delayAfterUiApiProbe(answered: boolean, previous: number): number {
  return answered ? UI_API_POLL_MAX_DELAY_MS : nextUiApiPollDelay(previous);
}

/** The statuses a proxy answers with when it could not reach what it fronts. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([500, 502, 503, 504]);

type ReadRefusal = {
  status?: unknown;
  code?: unknown;
};

/**
 * Whether this failed read means nothing answered, not a refusal. A
 * thrown error is the browser's own; an error object is unreachable only
 * with a gateway status and no error code — a code means something was reached.
 */
export function isUiApiUnreachable(error: unknown): boolean {
  if (error === null || error === void 0) return false;
  if (!(typeof error === "object")) return false;

  const refusal = error as ReadRefusal;
  if (typeof refusal.code === "string" && refusal.code.length > 0) return false;

  const status = refusal.status;
  if (status === void 0 || status === null) return true;
  if (typeof status !== "number") return false;
  if (status === 0) return true;
  return GATEWAY_STATUSES.has(status);
}

/** What the browser does about an API that is still starting. */
export type UiApiWaitState = {
  /**
   * How many times the health endpoint has answered since the wait began.
   * A count rather than a flag because a health route can come up before the
   * routes around it do: each answer is another reason to try the read again.
   */
  readonly answers: number;
  /** Whether the wait has run long enough to be worth explaining. */
  readonly explaining: boolean;
};

type HealthProbe = (path: string) => Promise<boolean>;

const probeUiApiHealth: HealthProbe = async (path) => {
  try {
    const response = await fetch(path, { method: "GET", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Polls the API's health route while the shell waits, reporting the one
 * moment that matters: the API answered. The caller re-runs the session
 * read; nothing here reloads, since that would lose the requested address.
 */
export function useUiApiWait({
  waiting,
  probe = probeUiApiHealth,
  hintAfterMs = UI_API_WAIT_HINT_AFTER_MS,
}: {
  waiting: boolean;
  probe?: HealthProbe;
  hintAfterMs?: number;
}): UiApiWaitState {
  const [answers, setAnswers] = useState(0);
  const [explaining, setExplaining] = useState(false);
  const probeRef = useRef(probe);
  probeRef.current = probe;

  useEffect(() => {
    if (!waiting) {
      setAnswers(0);
      setExplaining(false);
      return;
    }

    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = UI_API_POLL_FIRST_DELAY_MS;

    const explain = setTimeout(() => {
      if (live) setExplaining(true);
    }, hintAfterMs);

    const poll = async (): Promise<void> => {
      const answered = await probeRef.current(UI_API_HEALTH_PATH);
      if (!live) return;
      if (answered) {
        setAnswers((count) => count + 1);
        // Answering does not end the wait — the caller decides that by
        // re-reading the session. Polling continues, at the ceiling.
      }
      delay = delayAfterUiApiProbe(answered, delay);
      timer = setTimeout(() => void poll(), delay);
    };

    timer = setTimeout(() => void poll(), UI_API_POLL_FIRST_DELAY_MS);

    return () => {
      live = false;
      clearTimeout(explain);
      if (timer !== void 0) clearTimeout(timer);
    };
  }, [waiting, hintAfterMs]);

  return useMemo(() => ({ answers, explaining }), [answers, explaining]);
}

/**
 * The application's router: the root stanza every route hangs from.
 * Routes arrive already materialised (composing an element belongs to
 * `ui/sections`); what's left here is the shape of the tree itself.
 */

export type UiRouter = ReturnType<typeof createBrowserRouter>;

export type UiRouterOptions = {
  /** The application's routes, in match order. */
  routes: readonly RouteObject[];
  /** Wraps every route: router-context providers, navigation progress, Suspense. */
  rootComponent: ComponentType;
  /** Catches render and loader throws anywhere below the root. */
  rootErrorBoundary: ComponentType;
};

/**
 * React Router warns with no HydrateFallback, even though this app's
 * lazy() routes never block hydration. Nothing is correct: the root
 * layout's own Suspense already renders the right shell once children resolve.
 */
function HydrateFallback(): null {
  return null;
}

export function createUiRouter({
  routes,
  rootComponent,
  rootErrorBoundary,
}: UiRouterOptions): UiRouter {
  return createBrowserRouter([
    {
      Component: rootComponent,
      HydrateFallback,
      ErrorBoundary: rootErrorBoundary,
      children: [...routes],
    },
  ]);
}

/**
 * The navigation capability, over the router this package already owns —
 * `react-router` is sealed off from a frontend feature (ADR-004), so a
 * screen gets a `UiNavigation` instead, which a test can record.
 */

class RouterUiNavigation extends UiNavigation {
  constructor(private readonly navigateTo: NavigateFunction) {
    super();
  }

  navigate(to: string): void {
    void this.navigateTo(to);
  }

  replace(to: string): void {
    void this.navigateTo(to, { replace: true });
  }

  back(): void {
    void this.navigateTo(-1);
  }
}

/** The port over a router's navigate function, for tests and for the hook. */
export function createRouterUiNavigation({
  navigate,
}: {
  navigate: NavigateFunction;
}): UiNavigation {
  return new RouterUiNavigation(navigate);
}

/**
 * Only valid below `RouterProvider` — the application shell mounts it
 * inside the root layout, where every routed screen renders.
 */
export function useRouterUiNavigation(): UiNavigation {
  const navigate = useNavigate();
  return useMemo(() => createRouterUiNavigation({ navigate }), [navigate]);
}

/**
 * Params and query arrive as one flat reading. `useSearchParams` keeps a
 * multi-valued map; a repeated key collapses to its last value, since a
 * screen writing `?tab=sources` is asking a single-valued question.
 */
class RouterUiRoute extends UiRoute {
  constructor(
    private readonly values: UiRouteReadingValues,
    private readonly write: (
      next: Readonly<Record<string, string | undefined>>,
      options?: { replace?: boolean },
    ) => void,
  ) {
    super();
  }

  reading(): UiRouteReadingValues {
    return this.values;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.write(next, options);
  }
}

/** The reading and the writer, for a test that has neither a router nor a URL. */
export function createUiRoute({
  values,
  setQuery,
}: {
  values: UiRouteReadingValues;
  setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
}): UiRoute {
  return new RouterUiRoute(values, setQuery);
}

/** The route capability of the router this render is inside. */
export function useRouterUiRoute(): UiRoute {
  const params = useParams();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  return useMemo(() => {
    const query: Record<string, string | undefined> = {};
    searchParams.forEach((value, key) => {
      query[key] = value;
    });

    return createUiRoute({
      values: { params, query, pathname },
      setQuery: (next, options) => {
        const written = new URLSearchParams();
        for (const [key, value] of Object.entries(next)) {
          if (value !== void 0) written.set(key, value);
        }
        setSearchParams(written, { replace: options?.replace ?? false });
      },
    });
  }, [params, pathname, searchParams, setSearchParams]);
}

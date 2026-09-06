/**
 * Telling "the API did not answer" apart from "the API refused".
 * Spec: specs/ui/api-boot-wait.feature
 */

import { useEffect, useMemo, useRef, useState } from "react";

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

/** The statuses a proxy answers with when it could not reach what it fronts. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([500, 502, 503, 504]);

type ReadRefusal = {
  status?: unknown;
  code?: unknown;
};

/**
 * Whether this failed read means nothing answered, rather than something
 * answering with a refusal.
 *
 * A thrown error is the browser's own — the fetch never completed. An error
 * object is the endpoint's, and it is only unreachable when its status is a
 * gateway's own and it carries no error code: a code means some process named
 * the cause, and something that names a cause was reached.
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
 * Polls the API's health route while the shell is waiting, and reports the one
 * moment that matters: the API answered. The caller re-runs the session read;
 * nothing here reloads the document, because a reload would lose the address
 * the reader asked for.
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
        delay = UI_API_POLL_MAX_DELAY_MS;
      } else {
        delay = nextUiApiPollDelay(delay);
      }
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

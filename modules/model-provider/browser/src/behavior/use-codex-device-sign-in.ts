import { describeError } from "@langwatch/browser-host/errors";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { CODEX_SIGN_IN_TTL_MS } from "@langwatch/model-provider-contract";
import { nowInstant } from "@langwatch/time";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ScopeAssignment } from "../model/scope-assignment.ts";
import { api } from "./model-provider-api.ts";

/**
 * The Codex device-sign-in state machine, headless: start a device code,
 * poll until approved, and expose the account, keeping `CodexSignIn` presentational.
 * Spec: specs/model-providers/codex-account-provider.feature
 */

export type CodexSignInPhase =
  | { name: "idle" }
  | { name: "starting" }
  | {
      name: "pending";
      userCode: string;
      deviceAuthId: string;
      verificationUrl: string;
      intervalSeconds: number;
      startedAtMs: number;
    }
  | { name: "complete"; email: string; plan: string }
  | { name: "error"; message: string; timedOut: boolean };

type PendingPhase = Extract<CodexSignInPhase, { name: "pending" }>;

function clearPollTimer(timer: { current: ReturnType<typeof setTimeout> | null }): void {
  if (!timer.current) return;

  clearTimeout(timer.current);
  timer.current = null;
}

/** The registry's words for the failure; a handled error's own message is only its code. */
function failureMessage(error: unknown, fallback: string): string {
  return describeError({ error, fallbackTitle: fallback });
}

/** The issuer said the code ran out: as calm as our own timeout, with a fresh start offered. */
function isExpiredSignIn(error: unknown): boolean {
  const handled = readHandledError(error);
  return handled?.code === "codex_auth_failed" && handled.meta.kind === "sign_in_expired";
}

/**
 * The email is only known from THIS session's sign-in — the status query does
 * not expose it (see codexStatus) — so a re-visit shows the generic label.
 */
function connectedAccount({
  phase,
  storedStatus,
}: {
  phase: CodexSignInPhase;
  storedStatus: { plan: string } | null;
}): { email: string; plan: string } | null {
  if (phase.name === "complete") return { email: phase.email, plan: phase.plan };
  if (storedStatus) return { email: "", plan: storedStatus.plan };

  return null;
}

type PollRound = {
  attempt: number;
  attemptRef: { current: number };
  modelProviderId: string | undefined;
  onConnected?: (account: { email: string; plan: string }) => void;
  pending: PendingPhase;
  poll: {
    mutateAsync(input: {
      projectId: string;
      deviceAuthId: string;
      userCode: string;
      scopes: ScopeAssignment[];
      setAsCodingDefaults: boolean;
      modelProviderId?: string;
    }): Promise<{ status: "pending" } | { status: "complete"; email: string; plan: string }>;
  };
  projectId: string;
  scopes: ScopeAssignment[];
  setAsCodingDefaults: boolean;
  setPhase: (phase: CodexSignInPhase) => void;
  utils: { modelProvider: { invalidate: () => Promise<void> } };
};

/**
 * One poll round. The attempt check guards a stale timer from writing its result over a newer
 * one. The poll may also write new LANGY/FAST model defaults, so those answers are refreshed here.
 */
async function runPollRound({
  attempt,
  attemptRef,
  modelProviderId,
  onConnected,
  pending,
  poll,
  projectId,
  scopes,
  setAsCodingDefaults,
  setPhase,
  utils,
}: PollRound): Promise<"again" | "stop"> {
  if (attempt !== attemptRef.current) return "stop";

  const elapsedMs = nowInstant().epochMilliseconds - pending.startedAtMs;
  if (elapsedMs > CODEX_SIGN_IN_TTL_MS) {
    setPhase({
      name: "error",
      message: "The sign-in timed out before it was approved.",
      timedOut: true,
    });

    return "stop";
  }

  try {
    const result = await poll.mutateAsync({
      projectId,
      deviceAuthId: pending.deviceAuthId,
      userCode: pending.userCode,
      scopes,
      setAsCodingDefaults,
      modelProviderId,
    });
    if (attempt !== attemptRef.current) return "stop";
    if (result.status !== "complete") return "again";

    setPhase({ name: "complete", email: result.email, plan: result.plan });
    await utils.modelProvider.invalidate();
    onConnected?.({ email: result.email, plan: result.plan });

    return "stop";
  } catch (error) {
    if (attempt !== attemptRef.current) return "stop";

    setPhase({
      name: "error",
      message: failureMessage(error, "The sign-in failed. Try again."),
      timedOut: isExpiredSignIn(error),
    });

    return "stop";
  }
}

export function useCodexDeviceSignIn({
  projectId,
  modelProviderId,
  scopes,
  setAsCodingDefaults,
  onConnected,
}: {
  projectId: string;
  /** The row being re-authenticated, which the sign-in updates; absent saves a new row. */
  modelProviderId?: string;
  /** Where the provider row saves — callers pass the widest manageable scope. */
  scopes: ScopeAssignment[];
  /** Langy setup + onboarding pass true: also point Langy and the tiny
   *  assists at the codex model. Settings passes false. */
  setAsCodingDefaults: boolean;
  onConnected?: (account: { email: string; plan: string }) => void;
}) {
  const [phase, setPhase] = useState<CodexSignInPhase>({ name: "idle" });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pending sign-in this hook instance owns; a stale timer from a
  // cancelled attempt must never write its result over a newer one.
  const attemptRef = useRef(0);

  const status = api.modelProvider.codexStatus.useQuery({ projectId }, { enabled: !!projectId });
  const start = api.modelProvider.codexSignInStart.useMutation();
  const poll = api.modelProvider.codexSignInPoll.useMutation();
  const deleteProvider = api.modelProvider.delete.useMutation();
  const utils = api.useUtils();

  const clearTimer = () => clearPollTimer(pollTimer);
  useEffect(() => clearTimer, []);

  const schedulePoll = useCallback(
    ({ pending, attempt }: { pending: PendingPhase; attempt: number }) => {
      clearTimer();
      pollTimer.current = setTimeout(() => {
        void (async () => {
          const outcome = await runPollRound({
            attempt,
            attemptRef,
            modelProviderId,
            onConnected,
            pending,
            poll,
            projectId,
            scopes,
            setAsCodingDefaults,
            setPhase,
            utils,
          });
          if (outcome !== "again") return;

          schedulePoll({ pending, attempt });
        })();
      }, pending.intervalSeconds * 1000);
    },
    [modelProviderId, poll, projectId, scopes, setAsCodingDefaults, utils, onConnected],
  );

  const begin = useCallback(async () => {
    const attempt = ++attemptRef.current;
    setPhase({ name: "starting" });
    try {
      const device = await start.mutateAsync({ projectId });
      if (attempt !== attemptRef.current) return;
      const pending: PendingPhase = {
        name: "pending",
        userCode: device.userCode,
        deviceAuthId: device.deviceAuthId,
        verificationUrl: device.verificationUrl,
        intervalSeconds: device.intervalSeconds,
        startedAtMs: nowInstant().epochMilliseconds,
      };
      setPhase(pending);
      schedulePoll({ pending, attempt });
    } catch (error) {
      if (attempt !== attemptRef.current) return;
      setPhase({
        name: "error",
        message: failureMessage(error, "Could not reach OpenAI to start the sign-in."),
        timedOut: false,
      });
    }
  }, [projectId, schedulePoll, start]);

  const cancel = useCallback(() => {
    attemptRef.current++;
    clearTimer();
    setPhase({ name: "idle" });
  }, []);

  const storedStatus = status.data?.connected ? status.data : null;
  const storedProviderId = storedStatus?.providerId;

  const disconnect = useCallback(() => {
    if (!storedProviderId) return;
    void deleteProvider
      .mutateAsync({
        id: storedProviderId,
        projectId,
        provider: "openai_codex",
      })
      .then(async () => {
        setPhase({ name: "idle" });
        await utils.modelProvider.invalidate();
      });
  }, [deleteProvider, projectId, storedProviderId, utils]);

  const connected = connectedAccount({ phase, storedStatus });

  return {
    phase,
    connected,
    storedProviderId,
    begin,
    cancel,
    disconnect,
    disconnecting: deleteProvider.isPending,
  };
}

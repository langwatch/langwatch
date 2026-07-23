import { useCallback, useEffect, useRef, useState } from "react";
import { CODEX_SIGN_IN_TTL_MS } from "~/server/modelProviders/codexAccount.schema";
import type { ScopeAssignment } from "~/server/scopes/scope.types";
import { api } from "~/utils/api";

/**
 * The Codex device-sign-in state machine, headless: start a device code,
 * poll until approved, expose the connected account. `CodexSignIn` renders
 * it; the hook owns every timer and mutation so the component stays purely
 * presentational (spec: specs/model-providers/codex-account-provider.feature).
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

export function useCodexDeviceSignIn({
  projectId,
  scopes,
  setAsCodingDefaults,
  onConnected,
}: {
  projectId: string;
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

  const status = api.modelProvider.codexStatus.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  );
  const start = api.modelProvider.codexSignInStart.useMutation();
  const poll = api.modelProvider.codexSignInPoll.useMutation();
  const deleteProvider = api.modelProvider.delete.useMutation();
  const utils = api.useUtils();

  const clearTimer = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };
  useEffect(() => clearTimer, []);

  const schedulePoll = useCallback(
    ({ pending, attempt }: { pending: PendingPhase; attempt: number }) => {
      clearTimer();
      pollTimer.current = setTimeout(() => {
        void (async () => {
          if (attempt !== attemptRef.current) return;
          if (Date.now() - pending.startedAtMs > CODEX_SIGN_IN_TTL_MS) {
            setPhase({
              name: "error",
              message: "The sign-in timed out before it was approved.",
              timedOut: true,
            });
            return;
          }
          try {
            const result = await poll.mutateAsync({
              projectId,
              deviceAuthId: pending.deviceAuthId,
              userCode: pending.userCode,
              scopes,
              setAsCodingDefaults,
            });
            if (attempt !== attemptRef.current) return;
            if (result.status === "complete") {
              setPhase({
                name: "complete",
                email: result.email,
                plan: result.plan,
              });
              await utils.modelProvider.invalidate();
              onConnected?.({ email: result.email, plan: result.plan });
              return;
            }
            schedulePoll({ pending, attempt });
          } catch (error) {
            if (attempt !== attemptRef.current) return;
            setPhase({
              name: "error",
              message:
                error instanceof Error
                  ? error.message
                  : "The sign-in failed. Try again.",
              timedOut: false,
            });
          }
        })();
      }, pending.intervalSeconds * 1000);
    },
    [poll, projectId, scopes, setAsCodingDefaults, utils, onConnected],
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
        startedAtMs: Date.now(),
      };
      setPhase(pending);
      schedulePoll({ pending, attempt });
    } catch (error) {
      if (attempt !== attemptRef.current) return;
      setPhase({
        name: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not reach OpenAI to start the sign-in.",
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

  // The email is only known from THIS session's sign-in (the status query
  // doesn't expose it — see codexStatus); a re-visit shows the generic label.
  const connected =
    phase.name === "complete"
      ? { email: phase.email, plan: phase.plan }
      : storedStatus
        ? { email: "", plan: storedStatus.plan }
        : null;

  return {
    phase,
    connected,
    storedProviderId,
    begin,
    cancel,
    disconnect,
    disconnecting: deleteProvider.isLoading,
  };
}

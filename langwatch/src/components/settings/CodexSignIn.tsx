import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Check, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CODEX_SIGN_IN_TTL_MS } from "~/server/modelProviders/codexAccount.schema";
import type { ScopeAssignment } from "~/server/scopes/scope.types";
import { api } from "~/utils/api";
import { Link } from "../ui/link";

/**
 * Sign in with your OpenAI account — the Codex provider's whole credential
 * UI, shared verbatim by the settings drawer, Langy's inline setup and the
 * onboarding step (spec: specs/model-providers/codex-account-provider.feature).
 *
 * The flow is OpenAI's device authorization: show a one-time code, open
 * their verification page, poll until the user approves there. Nothing is
 * typed into LangWatch and nothing persists until the poll completes
 * server-side (which is also where the provider row + optional coding
 * defaults are written).
 */

type Phase =
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

export function CodexSignIn({
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
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pending sign-in this component instance owns; a stale timer from a
  // cancelled attempt must never write its result over a newer one.
  const attemptRef = useRef(0);

  const status = api.modelProvider.codexStatus.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  );
  const start = api.modelProvider.codexSignInStart.useMutation();
  const poll = api.modelProvider.codexSignInPoll.useMutation();
  const disconnect = api.modelProvider.delete.useMutation();
  const utils = api.useUtils();

  const clearTimer = () => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };
  useEffect(() => clearTimer, []);

  const schedulePoll = useCallback(
    (pending: Extract<Phase, { name: "pending" }>, attempt: number) => {
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
            schedulePoll(pending, attempt);
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
      const pending: Extract<Phase, { name: "pending" }> = {
        name: "pending",
        userCode: device.userCode,
        deviceAuthId: device.deviceAuthId,
        verificationUrl: device.verificationUrl,
        intervalSeconds: device.intervalSeconds,
        startedAtMs: Date.now(),
      };
      setPhase(pending);
      schedulePoll(pending, attempt);
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

  // ── Connected (from a previous session or the flow that just finished) ──
  const storedStatus = status.data?.connected ? status.data : null;
  const connected =
    phase.name === "complete"
      ? { email: phase.email, plan: phase.plan }
      : storedStatus
        ? { email: storedStatus.email, plan: storedStatus.plan }
        : null;

  if (connected && phase.name !== "pending" && phase.name !== "starting") {
    return (
      <VStack align="stretch" gap={2}>
        <HStack gap={2}>
          <Box color="green.fg">
            <Check size={15} />
          </Box>
          <Text fontSize="sm">
            Connected as <b>{connected.email || "your OpenAI account"}</b>
            {connected.plan ? ` (${connected.plan})` : null}
          </Text>
        </HStack>
        <Text fontSize="xs" color="fg.muted">
          Langy and the AI assists run on this account's plan. Usage counts
          against your OpenAI subscription limits, not API credits.
        </Text>
        <HStack gap={2}>
          <Button size="xs" variant="outline" onClick={() => void begin()}>
            <RefreshCw size={13} /> Re-authenticate
          </Button>
          {storedStatus?.providerId ? (
            <Button
              size="xs"
              variant="ghost"
              color="fg.muted"
              loading={disconnect.isLoading}
              onClick={() =>
                void disconnect
                  .mutateAsync({
                    id: storedStatus.providerId,
                    projectId,
                    provider: "openai_codex",
                  })
                  .then(async () => {
                    setPhase({ name: "idle" });
                    await utils.modelProvider.invalidate();
                  })
              }
            >
              <LogOut size={13} /> Disconnect
            </Button>
          ) : null}
        </HStack>
      </VStack>
    );
  }

  if (phase.name === "pending") {
    return (
      <VStack align="stretch" gap={3}>
        <Text fontSize="sm">
          Enter this code on OpenAI's device page to approve the sign-in:
        </Text>
        <HStack justify="space-between" gap={3} flexWrap="wrap">
          <Text
            fontSize="2xl"
            fontWeight="700"
            fontFamily="mono"
            letterSpacing="0.12em"
            aria-label="One-time sign-in code"
          >
            {phase.userCode}
          </Text>
          <Button asChild size="sm" colorPalette="orange">
            <Link
              href={phase.verificationUrl}
              isExternal
              _hover={{ textDecoration: "none" }}
            >
              Open openai.com <ExternalLink size={13} />
            </Link>
          </Button>
        </HStack>
        <HStack gap={2} color="fg.muted">
          <Spinner size="xs" />
          <Text fontSize="xs">Waiting for you to approve in the browser…</Text>
          <Button size="2xs" variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </HStack>
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={2}>
      {phase.name === "error" ? (
        <Text fontSize="xs" color="fg.error">
          {phase.message}
        </Text>
      ) : (
        <Text fontSize="xs" color="fg.muted">
          Sign in with your OpenAI account and Codex runs on your ChatGPT plan.
          No API key needed.
        </Text>
      )}
      <Box>
        <Button
          size="sm"
          colorPalette="orange"
          loading={phase.name === "starting"}
          onClick={() => void begin()}
        >
          {phase.name === "error" && phase.timedOut
            ? "Start sign-in again"
            : "Sign in with OpenAI"}
        </Button>
      </Box>
    </VStack>
  );
}

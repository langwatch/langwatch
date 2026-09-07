import {
  Box,
  Button,
  HStack,
  Input,
  Link,
  Progress,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  VOICE_CALL_SCENARIO_SET_ID,
  type VoiceTransport,
} from "~/server/agents/voice/voice-agent.config";
import {
  isRedCountdown,
  remainingSeconds,
} from "~/server/scenarios/voice/voice-countdown";
import {
  CONSENT_NOTICE,
  CUT_AT_LIMIT_MESSAGE,
  FETCH_FAILED_NOTICE,
  type TalkState,
  initialTalkState,
  talkReducer,
} from "./talkToItMachine";
import {
  type VoiceCallSession,
  voiceTransportClientRegistry,
} from "./voice-transport-client.registry";

/** The settings route that adds a model provider key (mirrors the drawer). */
const MODEL_PROVIDERS_ROUTE = "/settings/model-providers";

interface MintResponse {
  transport: VoiceTransport;
  sessionId: string;
  maxDurationSeconds: number;
  connect: { signedUrl: string };
}

export interface TalkToItPanelProps {
  projectId: string;
  projectSlug: string;
  transport: VoiceTransport;
  /** The transport's agent id from the form (never a database id). */
  agentId: string;
  /** The saved agent row id, when the drawer already has one. */
  agentRowId?: string;
  /** The agent name from the form, used to auto-create the row on hang-up. */
  name?: string;
  /** Told the row id when the call created the agent, so the drawer adopts it. */
  onAgentCreated?: (agentRowId: string) => void;
}

function formatMmSs(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

/**
 * The browser call panel: idle → connecting → live → saving → done, with mic,
 * mint and fetch failures surfaced as the AC copy. Transport-agnostic — it
 * opens the call through the client registry and never names a vendor.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
export function TalkToItPanel(props: TalkToItPanelProps) {
  const [state, dispatch] = useReducer(talkReducer, initialTalkState);
  const sessionRef = useRef<VoiceCallSession | null>(null);
  const startedAtRef = useRef<number>(0);
  const conversationIdRef = useRef<string | undefined>(undefined);
  const maxSecondsRef = useRef<number>(300);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [pendingName, setPendingName] = useState("");
  const createdRowIdRef = useRef<string | undefined>(props.agentRowId);

  const clearTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const finish = useCallback(
    async (cutAtLimit: boolean, nameOverride?: string) => {
      const transcript =
        "transcript" in state ? state.transcript : ([] as never[]);
      const body = {
        projectId: props.projectId,
        transport: props.transport,
        agentId: props.agentId,
        agentRowId: createdRowIdRef.current,
        name: nameOverride ?? props.name,
        conversationId: conversationIdRef.current,
        transcript,
        startedAt: startedAtRef.current || Date.now(),
        endedAt: Date.now(),
        cutAtLimit,
      };
      const res = await fetch(
        `/api/voice/session/${encodeURIComponent(
          conversationIdRef.current ?? "session",
        )}/finish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        if (data.code === "voice_name_required") {
          dispatch({ type: "NAME_REQUIRED" });
          return;
        }
        dispatch({
          type: "SAVE_FAILED",
          message:
            typeof data.message === "string"
              ? data.message
              : "Could not save the call",
        });
        return;
      }
      if (typeof data.agentId === "string" && data.agentId) {
        createdRowIdRef.current = data.agentId;
        if (!props.agentRowId) props.onAgentCreated?.(data.agentId);
      }
      dispatch({
        type: "SAVED",
        runId: String(data.runId ?? ""),
        agentId: String(data.agentId ?? ""),
        hasAudio: Boolean(data.hasAudio),
        fetchFailed: Boolean(data.fetchFailed),
      });
    },
    [props, state],
  );

  const endCall = useCallback(
    async (cutAtLimit: boolean) => {
      clearTick();
      dispatch(cutAtLimit ? { type: "LIMIT_REACHED" } : { type: "HANG_UP" });
      try {
        await sessionRef.current?.hangUp();
      } catch {
        // The socket may already be closed; the finish still runs.
      }
      await finish(cutAtLimit);
    },
    [clearTick, finish],
  );

  const start = useCallback(async () => {
    dispatch({ type: "START" });
    // Ask for the mic first so a denial is a clean, retryable state rather than
    // a stuck "Connecting" (AC27).
    try {
      const media = await navigator.mediaDevices?.getUserMedia({ audio: true });
      media?.getTracks().forEach((t) => {
        t.stop();
      });
    } catch {
      dispatch({ type: "MIC_DENIED" });
      return;
    }

    let mint: MintResponse;
    try {
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: props.projectId,
          transport: props.transport,
          agentId: props.agentId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        dispatch({
          type: "MINT_FAILED",
          code: data.code === "voice_key_missing" ? "key_missing" : "mint_failed",
          message: typeof data.message === "string" ? data.message : "Unknown",
        });
        return;
      }
      mint = data as unknown as MintResponse;
    } catch (error) {
      dispatch({
        type: "MINT_FAILED",
        code: "mint_failed",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    maxSecondsRef.current = mint.maxDurationSeconds;
    conversationIdRef.current = mint.sessionId;
    startedAtRef.current = Date.now();

    try {
      sessionRef.current = await voiceTransportClientRegistry[
        props.transport
      ].openCall({
        signedUrl: mint.connect.signedUrl,
        handlers: {
          onConnected: ({ conversationId }) => {
            conversationIdRef.current = conversationId;
            dispatch({ type: "CONNECTED", conversationId });
          },
          onTranscript: (turn) => dispatch({ type: "TRANSCRIPT", turn }),
          onDisconnect: () => {
            // The provider closed the call; finish it as a normal hang-up if we
            // have not already left the live view.
            void endCall(false);
          },
          onError: (error) =>
            dispatch({
              type: "MINT_FAILED",
              code: "mint_failed",
              message: error.message,
            }),
        },
      });
    } catch (error) {
      dispatch({
        type: "MINT_FAILED",
        code: "mint_failed",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    tickRef.current = setInterval(() => {
      const elapsedMs = Date.now() - startedAtRef.current;
      dispatch({ type: "TICK", elapsedMs });
      setMicLevel(sessionRef.current?.getInputVolume?.() ?? 0);
      if (elapsedMs >= maxSecondsRef.current * 1000) void endCall(true);
    }, 1000);
  }, [props, endCall]);

  // Open the call as soon as the panel mounts: pressing "Talk to it" is the
  // trigger, and the consent notice shows through the connecting state.
  useEffect(() => {
    void start();
    return () => clearTick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runHref =
    state.kind === "done" && state.runId
      ? `/${props.projectSlug}/simulations/${VOICE_CALL_SCENARIO_SET_ID}/${encodeURIComponent(
          state.runId,
        )}`
      : undefined;

  return (
    <VStack align="stretch" gap={4} data-testid="talk-to-it-panel">
      {(state.kind === "idle" || state.kind === "connecting") && (
        <Text
          fontSize="sm"
          color="fg.muted"
          data-testid="talk-consent-notice"
        >
          {CONSENT_NOTICE}
        </Text>
      )}

      {state.kind === "connecting" && (
        <HStack gap={2}>
          <Spinner size="sm" />
          <Text>Connecting</Text>
        </HStack>
      )}

      {state.kind === "live" && <LiveView state={state} micLevel={micLevel} onHangUp={() => void endCall(false)} maxSeconds={maxSecondsRef.current} />}

      {state.kind === "saving" && (
        <HStack gap={2}>
          <Spinner size="sm" />
          <Text>Saving the call</Text>
        </HStack>
      )}

      {state.kind === "needsName" && (
        <VStack align="stretch" gap={2} data-testid="talk-needs-name">
          <Text>Name this agent to save the call</Text>
          <Input
            value={pendingName}
            onChange={(e) => setPendingName(e.target.value)}
            placeholder="Enter agent name"
            data-testid="talk-name-input"
          />
          <Button
            colorPalette="blue"
            disabled={pendingName.trim().length === 0}
            onClick={() => {
              dispatch({ type: "HANG_UP" }); // back to saving
              void finish(state.cutAtLimit, pendingName.trim());
            }}
            data-testid="talk-name-save"
          >
            Save
          </Button>
        </VStack>
      )}

      {state.kind === "done" && (
        <DoneView state={state} runHref={runHref} />
      )}

      {state.kind === "error" && (
        <VStack align="stretch" gap={2} data-testid="talk-error">
          <Text color="fg.error">{state.message}</Text>
          {state.code === "key_missing" && (
            <Link
              href={MODEL_PROVIDERS_ROUTE}
              color="blue.fg"
              data-testid="talk-add-key"
            >
              Add key
            </Link>
          )}
          <Button
            variant="outline"
            onClick={() => void start()}
            data-testid="talk-retry"
          >
            Retry
          </Button>
        </VStack>
      )}
    </VStack>
  );
}

function LiveView({
  state,
  micLevel,
  onHangUp,
  maxSeconds,
}: {
  state: Extract<TalkState, { kind: "live" }>;
  micLevel: number;
  onHangUp: () => void;
  maxSeconds: number;
}) {
  const remaining = remainingSeconds({
    elapsedMs: state.elapsedMs,
    maxCallSeconds: maxSeconds,
  });
  const red = isRedCountdown(remaining);
  return (
    <VStack align="stretch" gap={3} data-testid="talk-live">
      <HStack justify="space-between">
        <Text
          fontWeight="bold"
          color={red ? "fg.error" : undefined}
          data-testid="talk-timer"
        >
          {formatMmSs(remaining)}
        </Text>
        <Button size="sm" colorPalette="red" onClick={onHangUp} data-testid="talk-hang-up">
          Hang up
        </Button>
      </HStack>
      <Progress.Root value={Math.round(micLevel * 100)} size="xs">
        <Progress.Track>
          <Progress.Range />
        </Progress.Track>
      </Progress.Root>
      <VStack align="stretch" gap={1} data-testid="talk-transcript">
        {state.transcript.map((turn, index) => (
          <Text key={index} fontSize="sm">
            <Text as="span" fontWeight="bold">
              {turn.role === "agent" ? "Agent" : "You"}:
            </Text>{" "}
            {turn.text}
          </Text>
        ))}
      </VStack>
    </VStack>
  );
}

function DoneView({
  state,
  runHref,
}: {
  state: Extract<TalkState, { kind: "done" }>;
  runHref?: string;
}) {
  return (
    <VStack align="stretch" gap={3} data-testid="talk-done">
      {state.cutAtLimit && (
        <Text color="fg.muted" data-testid="talk-cut-marker">
          {CUT_AT_LIMIT_MESSAGE}
        </Text>
      )}
      {state.fetchFailed && (
        <Text color="fg.muted" data-testid="talk-fetch-failed">
          {FETCH_FAILED_NOTICE}
        </Text>
      )}
      <VStack align="stretch" gap={1}>
        {state.transcript.map((turn, index) => (
          <Text key={index} fontSize="sm">
            <Text as="span" fontWeight="bold">
              {turn.role === "agent" ? "Agent" : "You"}:
            </Text>{" "}
            {turn.text}
          </Text>
        ))}
      </VStack>
      {state.hasAudio && runHref && (
        <Box data-testid="talk-play">
          {/* biome-ignore lint/a11y/useMediaCaption: recording playback, no caption track */}
          <audio controls preload="none" />
        </Box>
      )}
      {runHref && (
        <Link href={runHref} color="blue.fg" data-testid="talk-run-link">
          Open the run
        </Link>
      )}
    </VStack>
  );
}

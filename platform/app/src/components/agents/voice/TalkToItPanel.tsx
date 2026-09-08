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
import { VOICE_CALL_MAX_SECONDS_DEFAULT } from "~/server/scenarios/voice/voice-limits";
import {
  CONSENT_NOTICE,
  CUT_AT_LIMIT_MESSAGE,
  FETCH_FAILED_NOTICE,
  initialTalkState,
  type TalkEvent,
  type TalkState,
  talkReducer,
} from "./talkToItMachine";
import {
  type VoiceCallSession,
  type VoiceTurn,
  voiceTransportClientRegistry,
} from "./voice-transport-client.registry";

/** The settings route that adds a model provider key (mirrors the drawer). */
const MODEL_PROVIDERS_ROUTE = "/settings/model-providers";

/** Placeholder cap before minting; the session mint response replaces it. */
const PRE_MINT_MAX_SECONDS_PLACEHOLDER = VOICE_CALL_MAX_SECONDS_DEFAULT;

interface MintResponse {
  transport: VoiceTransport;
  sessionToken: string;
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
  /**
   * The scenario a "Call it myself" run is scored under (AC23). When set, the
   * finished call is written under this scenario, listed beside its simulated
   * runs and graded against its criteria. Absent for a drawer call.
   */
  scenarioId?: string;
}

function formatMmSs(totalSeconds: number): string {
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

/** Mutable slots the call machinery reads and writes across a session. */
type TalkRefs = {
  session: { current: VoiceCallSession | null };
  startedAt: { current: number };
  conversationId: { current: string | undefined };
  // The signed session token from mint, carried back verbatim to finish.
  sessionToken: { current: string | undefined };
  maxSeconds: { current: number };
  // The set the finished run landed in, learned from the finish response, so a
  // scenario call links to the scenario's set rather than the voice-call set.
  runSetId: { current: string | undefined };
  tick: { current: ReturnType<typeof setInterval> | null };
  createdRowId: { current: string | undefined };
};

function createTalkRefs(agentRowId: string | undefined): TalkRefs {
  return {
    session: { current: null },
    startedAt: { current: 0 },
    conversationId: { current: undefined },
    sessionToken: { current: undefined },
    maxSeconds: { current: PRE_MINT_MAX_SECONDS_PLACEHOLDER },
    runSetId: { current: undefined },
    tick: { current: null },
    createdRowId: { current: agentRowId },
  };
}

/** The run link the done view offers, or undefined until a run exists. */
function runHrefOf({
  state,
  runSetId,
  projectSlug,
}: {
  state: TalkState;
  runSetId: string | undefined;
  projectSlug: string;
}): string | undefined {
  if (state.kind !== "done" || !state.runId) return undefined;
  return `/${projectSlug}/simulations/${
    runSetId ?? VOICE_CALL_SCENARIO_SET_ID
  }/${encodeURIComponent(state.runId)}`;
}

function stopTick(refs: TalkRefs): void {
  if (refs.tick.current) {
    clearInterval(refs.tick.current);
    refs.tick.current = null;
  }
}

function applyFinishFailure(
  dispatch: (event: TalkEvent) => void,
  data: Record<string, unknown>,
): void {
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
}

function applyFinishSuccess({
  props,
  refs,
  dispatch,
  data,
}: {
  props: TalkToItPanelProps;
  refs: TalkRefs;
  dispatch: (event: TalkEvent) => void;
  data: Record<string, unknown>;
}): void {
  if (typeof data.agentId === "string" && data.agentId) {
    refs.createdRowId.current = data.agentId;
    if (!props.agentRowId) props.onAgentCreated?.(data.agentId);
  }
  if (typeof data.scenarioSetId === "string" && data.scenarioSetId) {
    refs.runSetId.current = data.scenarioSetId;
  }
  dispatch({
    type: "SAVED",
    runId: String(data.runId ?? ""),
    agentId: String(data.agentId ?? ""),
    hasAudio: Boolean(data.hasAudio),
    audioUrl: typeof data.audioUrl === "string" ? data.audioUrl : undefined,
    fetchFailed: Boolean(data.fetchFailed),
  });
}

async function runFinish({
  props,
  refs,
  dispatch,
  state,
  cutAtLimit,
  nameOverride,
}: {
  props: TalkToItPanelProps;
  refs: TalkRefs;
  dispatch: (event: TalkEvent) => void;
  state: TalkState;
  cutAtLimit: boolean;
  nameOverride?: string;
}): Promise<void> {
  const transcript = "transcript" in state ? state.transcript : ([] as never[]);
  const body = {
    projectId: props.projectId,
    sessionToken: refs.sessionToken.current ?? "",
    name: nameOverride ?? props.name,
    conversationId: refs.conversationId.current,
    transcript,
    startedAt: refs.startedAt.current || Date.now(),
    endedAt: Date.now(),
    cutAtLimit,
    ...(props.scenarioId ? { scenarioId: props.scenarioId } : {}),
  };
  const res = await fetch(
    `/api/voice/session/${encodeURIComponent(
      refs.conversationId.current ?? "session",
    )}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    applyFinishFailure(dispatch, data);
    return;
  }
  applyFinishSuccess({ props, refs, dispatch, data });
}

async function runEndCall({
  refs,
  dispatch,
  finish,
  cutAtLimit,
}: {
  refs: TalkRefs;
  dispatch: (event: TalkEvent) => void;
  finish: (cutAtLimit: boolean) => Promise<void>;
  cutAtLimit: boolean;
}): Promise<void> {
  stopTick(refs);
  dispatch(cutAtLimit ? { type: "LIMIT_REACHED" } : { type: "HANG_UP" });
  try {
    await refs.session.current?.hangUp();
  } catch {
    // The socket may already be closed; the finish still runs.
  }
  await finish(cutAtLimit);
}

/** Ask for the mic first so a denial is a clean, retryable state (AC27). */
async function requestMic(
  dispatch: (event: TalkEvent) => void,
): Promise<boolean> {
  try {
    const media = await navigator.mediaDevices?.getUserMedia({ audio: true });
    media?.getTracks().forEach((t) => {
      t.stop();
    });
    return true;
  } catch {
    dispatch({ type: "MIC_DENIED" });
    return false;
  }
}

async function mintSession({
  props,
  refs,
  dispatch,
}: {
  props: TalkToItPanelProps;
  refs: TalkRefs;
  dispatch: (event: TalkEvent) => void;
}): Promise<MintResponse | null> {
  try {
    const res = await fetch("/api/voice/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: props.projectId,
        transport: props.transport,
        // Used only when there is no saved row yet (an unsaved draft); once
        // a row exists the server reads its own stored vendor id instead
        // (AC13/AC29), so this is ignored rather than trusted at that point.
        agentId: props.agentId,
        // Undefined is dropped by JSON.stringify, so an unsaved agent sends
        // no row id.
        agentRowId: refs.createdRowId.current,
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
      return null;
    }
    return data as unknown as MintResponse;
  } catch (error) {
    dispatch({
      type: "MINT_FAILED",
      code: "mint_failed",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function runStart({
  props,
  refs,
  dispatch,
  setMicLevel,
  endCall,
}: {
  props: TalkToItPanelProps;
  refs: TalkRefs;
  dispatch: (event: TalkEvent) => void;
  setMicLevel: (level: number) => void;
  endCall: (cutAtLimit: boolean) => void;
}): Promise<void> {
  dispatch({ type: "START" });
  if (!(await requestMic(dispatch))) return;

  const mint = await mintSession({ props, refs, dispatch });
  if (!mint) return;

  refs.maxSeconds.current = mint.maxDurationSeconds;
  refs.sessionToken.current = mint.sessionToken;
  refs.startedAt.current = Date.now();

  try {
    refs.session.current = await voiceTransportClientRegistry[
      props.transport
    ].openCall({
      signedUrl: mint.connect.signedUrl,
      handlers: {
        onConnected: ({ conversationId }) => {
          refs.conversationId.current = conversationId;
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

  refs.tick.current = setInterval(() => {
    const elapsedMs = Date.now() - refs.startedAt.current;
    dispatch({ type: "TICK", elapsedMs });
    setMicLevel(refs.session.current?.getInputVolume?.() ?? 0);
    if (elapsedMs >= refs.maxSeconds.current * 1000) void endCall(true);
  }, 1000);
}

/** All the call state and callbacks the panel and its views render from. */
function useTalkToItCall(props: TalkToItPanelProps) {
  const [state, dispatch] = useReducer(talkReducer, initialTalkState);
  const [micLevel, setMicLevel] = useState(0);
  const [pendingName, setPendingName] = useState("");
  const refsRef = useRef<TalkRefs | null>(null);
  if (!refsRef.current) refsRef.current = createTalkRefs(props.agentRowId);
  const refs = refsRef.current;

  const finish = useCallback(
    (cutAtLimit: boolean, nameOverride?: string) =>
      runFinish({ props, refs, dispatch, state, cutAtLimit, nameOverride }),
    [props, refs, state],
  );
  const endCall = useCallback(
    (cutAtLimit: boolean) => runEndCall({ refs, dispatch, finish, cutAtLimit }),
    [refs, finish],
  );
  const start = useCallback(
    () => runStart({ props, refs, dispatch, setMicLevel, endCall }),
    [props, refs, endCall],
  );
  const saveWithName = useCallback(
    (cutAtLimit: boolean, name: string) => {
      dispatch({ type: "HANG_UP" }); // back to saving
      void finish(cutAtLimit, name);
    },
    [finish],
  );

  // Open the call as soon as the panel mounts: pressing "Talk to it" is the
  // trigger, and the consent notice shows through the connecting state.
  useEffect(() => {
    void start();
    return () => stopTick(refs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    state,
    micLevel,
    pendingName,
    setPendingName,
    start,
    endCall,
    saveWithName,
    maxSeconds: refs.maxSeconds.current,
    runHref: runHrefOf({
      state,
      runSetId: refs.runSetId.current,
      projectSlug: props.projectSlug,
    }),
  };
}

/**
 * The browser call panel: idle → connecting → live → saving → done, with mic,
 * mint and fetch failures surfaced as the AC copy. Transport-agnostic — it
 * opens the call through the client registry and never names a vendor.
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */
export function TalkToItPanel(props: TalkToItPanelProps) {
  const {
    state,
    micLevel,
    pendingName,
    setPendingName,
    start,
    endCall,
    saveWithName,
    maxSeconds,
    runHref,
  } = useTalkToItCall(props);

  return (
    <VStack align="stretch" gap={4} data-testid="talk-to-it-panel">
      {(state.kind === "idle" || state.kind === "connecting") && (
        <Text fontSize="sm" color="fg.muted" data-testid="talk-consent-notice">
          {CONSENT_NOTICE}
        </Text>
      )}

      {state.kind === "connecting" && (
        <HStack gap={2}>
          <Spinner size="sm" />
          <Text>Connecting</Text>
        </HStack>
      )}

      {state.kind === "live" && (
        <LiveView
          state={state}
          micLevel={micLevel}
          onHangUp={() => void endCall(false)}
          maxSeconds={maxSeconds}
        />
      )}

      {state.kind === "saving" && (
        <HStack gap={2}>
          <Spinner size="sm" />
          <Text>Saving the call</Text>
        </HStack>
      )}

      {state.kind === "needsName" && (
        <NeedsNameView
          state={state}
          pendingName={pendingName}
          setPendingName={setPendingName}
          onSave={saveWithName}
        />
      )}

      {state.kind === "done" && <DoneView state={state} runHref={runHref} />}

      {state.kind === "error" && (
        <ErrorView state={state} onRetry={() => void start()} />
      )}
    </VStack>
  );
}

function NeedsNameView({
  state,
  pendingName,
  setPendingName,
  onSave,
}: {
  state: Extract<TalkState, { kind: "needsName" }>;
  pendingName: string;
  setPendingName: (value: string) => void;
  onSave: (cutAtLimit: boolean, name: string) => void;
}) {
  return (
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
        onClick={() => onSave(state.cutAtLimit, pendingName.trim())}
        data-testid="talk-name-save"
      >
        Save
      </Button>
    </VStack>
  );
}

function ErrorView({
  state,
  onRetry,
}: {
  state: Extract<TalkState, { kind: "error" }>;
  onRetry: () => void;
}) {
  return (
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
      <Button variant="outline" onClick={onRetry} data-testid="talk-retry">
        Retry
      </Button>
    </VStack>
  );
}

/** The turn-by-turn transcript, shared by the live and done views. */
function Transcript({ turns }: { turns: VoiceTurn[] }) {
  return (
    <>
      {turns.map((turn, index) => (
        <Text key={index} fontSize="sm">
          <Text as="span" fontWeight="bold">
            {turn.role === "agent" ? "Agent" : "You"}:
          </Text>{" "}
          {turn.text}
        </Text>
      ))}
    </>
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
        <Button
          size="sm"
          colorPalette="red"
          onClick={onHangUp}
          data-testid="talk-hang-up"
        >
          Hang up
        </Button>
      </HStack>
      <Progress.Root value={Math.round(micLevel * 100)} size="xs">
        <Progress.Track>
          <Progress.Range />
        </Progress.Track>
      </Progress.Root>
      <VStack align="stretch" gap={1} data-testid="talk-transcript">
        <Transcript turns={state.transcript} />
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
        <Transcript turns={state.transcript} />
      </VStack>
      {state.audioUrl && (
        <Box data-testid="talk-play">
          <audio controls preload="none" src={state.audioUrl} />
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

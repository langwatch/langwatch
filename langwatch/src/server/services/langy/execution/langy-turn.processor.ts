/**
 * Langy turn processor + spawn function (ADR-044 parts 1–3).
 *
 * A direct analog of `startScenarioProcessor`. `startLangyTurnProcessor` wires
 * the pool's spawn function, boots the reconcile sweep, and returns a shutdown
 * handle that drains in-flight turns. `runTurn` is the spawn function: it does
 * what the old `/chat` stream executor did, minus holding a browser socket.
 *
 *   1. POST {OPENCODE_AGENT_URL}/chat with the internal Bearer secret.
 *   2. Bridge the manager's NDJSON: token deltas -> the Redis token buffer; the
 *      TOOL STREAM -> tool cards, PR-flow progress (ephemeral) and, when
 *      `gh pr create` settles, a DURABLE `tool_call_completed` (PR opened).
 *   3. Refresh the heartbeat key on a timer for the turn's life (liveness).
 *   4. On completion: `finalizeTurn` (turn_finalized, the whole answer) + end
 *      marker. On error: `failTurn` (agent_turn_failed) + error marker.
 *
 * @see src/server/scenarios/scenario.processor.ts (the pattern copied)
 * @see specs/langy/langy-event-driven-turns.feature
 */

import { createLogger } from "~/utils/logger/server";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { mintLangySessionApiKeyForUser } from "~/server/services/langy/langyApiKey";
import { auditLog } from "~/server/auditLog";
import { connection } from "~/server/redis";
import {
  recordExtraLangyGithubPrs,
  releaseLangyGithubPrPermit,
} from "~/server/middleware/rate-limit-langy-github-prs";
import {
  extractGithubPrLinks,
  type GithubPrLink,
} from "~/server/services/langy/githubPrLinks";
import type { LangyConversationService } from "~/server/app-layer/langy/langy-conversation.service";
import { buildFinalAssistantParts } from "~/server/app-layer/langy/langy-final-parts";
import { LANGY_LIVENESS } from "../streaming/langy.streaming.constants";
import { RedisLangyEphemeralPublisher } from "../streaming/langyEphemeralPublisher";
import type { LangyEphemeralPublisher } from "~/server/event-sourcing/pipelines/langy-conversation-processing/ephemeral";
import {
  createLangyTokenBuffer,
  LangyTokenBuffer,
} from "../streaming/langyTokenBuffer";
import {
  LangyFastTokenPublisher,
  LANGY_FAST_TOKEN_TYPE,
} from "../streaming/langyFastStream";
import { createLangyTurnHandoffStore } from "../streaming/langyTurnHandoff";
import {
  LangyCliEnvelopeService,
  type LangyToolFrame,
} from "./langy-cli-envelope.service";
import {
  AGENT_CHAT_TIMEOUT_MS,
  LangyAgentUnavailableError,
  LangyGithubNotConnectedError,
  LangyWorkerRestartingError,
  classifyLangyTurnError,
  langyAgentErrorFromFrame,
  serializeLangyTurnError,
} from "./langy-turn-errors";
import { resolveServerRecovery } from "./langy-turn-recovery";
import {
  githubStepOf,
  needsGithubAuth,
  type GithubProgressEvent,
} from "./githubCommand";
import { fetchGithubPrDetails } from "./githubPrDetails";
import {
  LANGY_OPEN_PR_TOOL,
  type GithubPrCardData,
} from "~/shared/langy/githubPrCard";
import type { LangyTurnJobData, LangyWorkerPool } from "./langy-worker-pool";
import {
  reconcileLangyTurns,
  type LangyTurnReconcilerDeps,
} from "./langy-turn-reconciler";

const logger = createLogger("langwatch:langy:turn-processor");

/**
 * 428 Precondition Required. The manager says: "I must spawn a worker for this
 * turn, and a spawn needs a session key — you sent none."
 *
 * The route deliberately omits the key when its pre-flight probe says a live
 * worker already holds one. This status is what closes the window where that
 * worker dies in between. See `Credentials.Spawnable` / ErrCredentialsRequired.
 */
const HTTP_CREDENTIALS_REQUIRED = 428;

/** The backoff wait between server-side turn retries. */
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Return a turn's up-front GitHub-PR permit, but ONLY if it was actually
 * reserved. The release-only-if-`permitReserved` latch is load-bearing: a
 * Redis-down reserve returns `reserved:false`, and DECRing that would walk the
 * shared daily counter negative (the erosion-via-blip cap-bypass). Best-effort —
 * a release failure warns and is swallowed so it never masks the turn's outcome.
 * `context` names the path releasing (handoff / failure / drain). The failure,
 * handoff and drain paths all release the same way; this is that one way.
 */
async function releasePermitIfReserved({
  job,
  log,
  context,
}: {
  job: LangyTurnJobData;
  log: Pick<typeof logger, "warn">;
  context: string;
}): Promise<void> {
  if (!job.permitReserved) return;
  await releaseLangyGithubPrPermit({ userId: job.actorUserId }).catch(
    (releaseError) =>
      log.warn(
        { releaseError, turnId: job.turnId },
        `failed to release PR permit on ${context}`,
      ),
  );
}

/**
 * Langy reaches LangWatch through the `langwatch` CLI, which opencode runs in
 * its `bash` tool — so a trace search arrives as an opaque shell command. This
 * decodes it back into the typed capability before anything is recorded.
 */
const cliEnvelope = LangyCliEnvelopeService.create();

export interface RunTurnDeps {
  conversations: LangyConversationService;
  ephemeral: LangyEphemeralPublisher;
  buffer: LangyTokenBuffer;
  /**
   * Stream B (ADR-048): raw opencode tokens are fanned onto an ephemeral
   * per-turn Redis pub/sub channel for the fast-path SSE. Fire-and-forget —
   * a failed publish degrades Stream B to durable-only and never fails the turn.
   */
  fastPublisher: LangyFastTokenPublisher;
  agentUrl: string;
  internalSecret: string;
  fetchImpl?: typeof fetch;
  /**
   * The backoff wait between server-side turn retries. Injectable so a test can
   * exercise the recovery loop without sitting through the real schedule.
   */
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Parse an OpenCode NDJSON line into a text delta, or detect a hard error. Kept
 * byte-identical to the old route's `handleLine` (message.part.delta with
 * field=text, plus the legacy `text` shape); adds `error` event detection so an
 * at-capacity / opencode error terminalizes the turn instead of hanging.
 *
 * Also recognises the manager's Stream B `langy.token` fast frame (ADR-048) —
 * routed to the ephemeral fast channel, NOT the durable buffer. The manager
 * emits it ALONGSIDE the full `message.part.delta` event, so the durable path
 * (fed by `message.part.delta` below) is unchanged and never double-counts.
 */
function parseAgentLine(line: string): {
  delta?: string;
  error?: string;
  handoff?: string;
  fastToken?: string;
  tool?: LangyToolFrame;
  progress?: boolean;
} | null {
  if (!line.trim()) return null;
  try {
    const event = JSON.parse(line) as {
      type?: string;
      error?: string;
      token?: string;
      text?: string;
      part?: { type?: string; text?: string };
      properties?: { field?: string; delta?: string; token?: string };
      // langy.tool frame fields
      id?: string;
      name?: string;
      phase?: string;
      title?: string;
      input?: unknown;
      output?: string;
      isError?: boolean;
    };
    if (event.type === LANGY_FAST_TOKEN_TYPE) {
      return typeof event.text === "string" && event.text
        ? { fastToken: event.text }
        : null;
    }
    // A "still working" heartbeat frame the agent emits on a timer so a long,
    // silent tool call never stalls the stream. Ephemeral: it carries nothing to
    // persist — the reader just refreshes the turn's liveness key on it.
    if (event.type === "langy.progress") {
      return { progress: true };
    }
    // A tool-call lifecycle frame (ADR-044/tool events). Forwarded ALONGSIDE the
    // text/token frames, so the durable answer path is unchanged.
    if (
      event.type === "langy.tool" &&
      typeof event.id === "string" &&
      typeof event.name === "string"
    ) {
      return {
        tool: {
          id: event.id,
          name: event.name,
          phase: event.phase === "end" ? "end" : "start",
          ...(typeof event.title === "string" ? { title: event.title } : {}),
          ...(event.input !== undefined ? { input: event.input } : {}),
          ...(typeof event.output === "string" ? { output: event.output } : {}),
          ...(typeof event.isError === "boolean"
            ? { isError: event.isError }
            : {}),
        },
      };
    }
    if (event.type === "error") {
      return { error: event.error || "agent error" };
    }
    // ADR-048: a terminal handoff frame carries an opaque resume token the
    // worker authored when it checkpointed on manager shutdown. Empty string is
    // still a handoff (the turn ended for handoff), just with nothing to resume.
    if (event.type === "handoff") {
      const token =
        typeof event.token === "string"
          ? event.token
          : typeof event.properties?.token === "string"
            ? event.properties.token
            : "";
      return { handoff: token };
    }
    if (event.type === "text" && event.part?.text) {
      return { delta: event.part.text };
    }
    if (
      event.type === "message.part.delta" &&
      event.properties?.field === "text" &&
      typeof event.properties?.delta === "string"
    ) {
      return { delta: event.properties.delta };
    }
    return null;
  } catch {
    return null; // ignore malformed/partial JSON lines
  }
}

/**
 * Run one Langy turn end-to-end. The spawn function for the `LangyWorkerPool`.
 */
export async function runTurn(
  job: LangyTurnJobData,
  deps: RunTurnDeps,
): Promise<void> {
  const {
    projectId,
    conversationId,
    turnId,
    prompt,
    system,
    modelOverride,
    credentials,
    resumeToken,
  } = job;
  // Once-only guard for the credentials_required re-mint below. A manager that
  // keeps asking must not be able to make us mint keys in a loop.
  let hasRemintedKey = false;
  const doFetch = deps.fetchImpl ?? fetch;
  const doSleep = deps.sleepImpl ?? sleep;
  const turnLogger = logger.child({ projectId, conversationId, turnId });

  // Whether this turn was handed a GitHub token at all. The route mints one only
  // when the user has connected their account (and strips it when the daily PR
  // cap is reached), so its absence is exactly "the agent cannot do GitHub on
  // this turn" — known up front, without asking the model anything.
  const hasGithubToken = !!(credentials as { githubToken?: string })
    ?.githubToken;
  const shellCommandOf = (frame: LangyToolFrame) =>
    cliEnvelope.shellCommandOf(frame);

  const heartbeat = setInterval(() => {
    void deps.buffer
      .heartbeat({ conversationId, turnId })
      .catch((error) =>
        turnLogger.debug({ error }, "heartbeat refresh failed"),
      );
  }, LANGY_LIVENESS.HEARTBEAT_INTERVAL_MS);
  // Beat once immediately so a turn is "live" before the first interval tick.
  await deps.buffer.heartbeat({ conversationId, turnId }).catch(() => {});

  let fullText = "";
  // The PRs this turn actually opened, read from `gh pr create`'s own stdout —
  // never from the model's prose. The daily cap and the audit log reconcile
  // against THIS.
  const openedPrLinks: GithubPrLink[] = [];
  /** A failing tool can fail with megabytes; an event is not a log sink. */
  const MAX_EVENT_ERROR_TEXT = 2_000;
  // Tool calls seen this turn, keyed by id — accumulated so the FINAL durable
  // message can carry them as parts (event-driven recovery: a refresh replays
  // the tool cards, not just the prose). The live edge already showed them via
  // the buffer as they happened.
  const toolCalls = new Map<
    string,
    {
      id: string;
      name: string;
      input?: unknown;
      output?: string;
      isError?: boolean;
      /** Wall-clock start, so the completed event can carry a duration. */
      startedAt?: number;
    }
  >();

  const handleTool = async (rawTool: LangyToolFrame) => {
    // The agent is reaching for GitHub on a turn that has no GitHub token: the
    // user has never connected their account. Stop the turn HERE, at the exact
    // moment the missing capability is needed — not as a blanket pre-flight
    // (most turns never touch GitHub and must not be stopped), and not by asking
    // the model to notice and announce it in prose. We can see it run `gh`.
    //
    // The browser turns this into the in-chat Connect card, and connecting
    // re-drives the turn; the reserved PR permit is returned by the failure path
    // below, so a stalled turn never eats a daily slot.
    if (
      rawTool.phase === "start" &&
      !hasGithubToken &&
      needsGithubAuth(shellCommandOf(rawTool) ?? "")
    ) {
      throw new LangyGithubNotConnectedError();
    }

    // The PR-flow progress card, read off the command itself. `gh pr create`
    // settling is the moment a PR exists, and its stdout carries the URL.
    const step = githubStepOf(shellCommandOf(rawTool) ?? "");
    if (step) {
      if (rawTool.phase === "start") {
        if (step.begin) {
          await publishProgress({ stage: step.begin, detail: step.detail });
        }
      } else if (!rawTool.isError) {
        // A FAILED command completed no step — a push that was rejected has not
        // pushed. The prose protocol could not tell the difference; the tool
        // stream can, because it carries `isError`.
        if (step.end === "opened") {
          await recordOpenedPrs(rawTool.output);
        } else {
          await publishProgress({ stage: step.end, detail: step.detail });
        }
      }
    }

    // Re-typed BEFORE anything is recorded, so the durable events, the live
    // buffer, and the cards the browser draws from them all speak capabilities,
    // never shells.
    //
    // An end frame is re-typed against the input we saw on its START. The
    // command is what identifies a CLI call, and a frame that arrives without one
    // cannot be re-typed at all — which is how a call could be recorded as
    // `langwatch.trace.search` when it opened and plain `bash` when it closed,
    // the two halves of one call disagreeing about what it was. Remembering the
    // input keeps the pair consistent whatever any single frame happens to carry.
    const started = toolCalls.get(rawTool.id);
    const framed =
      rawTool.phase === "end" &&
      rawTool.input === undefined &&
      started?.input !== undefined
        ? { ...rawTool, input: started.input }
        : rawTool;
    const tool = cliEnvelope.normalizeToolFrame({ frame: framed });
    // The command, lifted out of the input, is what makes a `bash` event mean
    // something to whoever reads the log later.
    const command = shellCommandOf(framed) ?? undefined;
    if (tool.phase === "start") {
      toolCalls.set(tool.id, {
        id: tool.id,
        name: tool.name,
        input: tool.input,
        startedAt: Date.now(),
      });
      // Durable milestone (event log) + live mirror (Redis) — separate transports.
      await deps.conversations
        .recordToolCallStarted({
          projectId,
          conversationId,
          turnId,
          toolCallId: tool.id,
          toolName: tool.name,
          ...(command !== undefined ? { command } : {}),
          ...(tool.input !== undefined ? { input: tool.input } : {}),
        })
        .catch((error) =>
          turnLogger.debug(
            { error, tool: tool.name },
            "recordToolCallStarted failed",
          ),
        );
      await deps.buffer
        .appendTool({
          conversationId,
          turnId,
          id: tool.id,
          name: tool.name,
          phase: "start",
          ...(tool.title !== undefined ? { title: tool.title } : {}),
          ...(tool.input !== undefined ? { input: tool.input } : {}),
        })
        .catch(() => {});
      return;
    }
    // phase === "end"
    const existing = toolCalls.get(tool.id) ?? { id: tool.id, name: tool.name };
    toolCalls.set(tool.id, {
      ...existing,
      output: tool.output,
      isError: tool.isError,
    });
    // How long the call actually took. Without it the log tells you a call
    // happened but never that it was the slow one.
    const durationMs =
      existing.startedAt !== undefined
        ? Date.now() - existing.startedAt
        : undefined;
    // A failure's message is the useful half of the failure. Capped, because a
    // tool can fail with megabytes and this is an event, not a log sink.
    const errorText =
      tool.isError && tool.output
        ? tool.output.slice(0, MAX_EVENT_ERROR_TEXT)
        : undefined;
    await deps.conversations
      .recordToolCallCompleted({
        projectId,
        conversationId,
        turnId,
        toolCallId: tool.id,
        toolName: tool.name,
        ...(tool.isError !== undefined ? { isError: tool.isError } : {}),
        ...(command !== undefined ? { command } : {}),
        ...(existing.input !== undefined ? { input: existing.input } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(errorText !== undefined ? { errorText } : {}),
      })
      .catch((error) =>
        turnLogger.debug(
          { error, tool: tool.name },
          "recordToolCallCompleted failed",
        ),
      );
    await deps.buffer
      .appendTool({
        conversationId,
        turnId,
        id: tool.id,
        name: tool.name,
        phase: "end",
        // The input rides the end entry too, so a card rebuilt from the buffer
        // alone (a reload mid-turn, a replay) can still say what the call was.
        ...(existing.input !== undefined ? { input: existing.input } : {}),
        ...(tool.output !== undefined ? { output: tool.output } : {}),
        ...(tool.isError !== undefined ? { isError: tool.isError } : {}),
      })
      .catch(() => {});
  };

  /**
   * The PR-flow progress card, driven by what the agent RUNS.
   *
   * Previously the skill asked the model to print `[langy:progress:<stage>]`
   * markers into its reply and this parsed them back out of the prose. `git push`
   * IS the push — there was never anything to announce, and asking an LLM to
   * narrate its own state machine meant it could paraphrase a marker, forget one,
   * or emit `opened` on a turn that opened nothing.
   *
   * A transient stage ("cloning…") is ephemeral (Redis, never the event log). A
   * PR actually opening is a real, persisted result: a durable milestone.
   */
  const publishProgress = async (event: GithubProgressEvent) => {
    await deps.ephemeral.publish(projectId, {
      type: "lw.langy_conversation.progress_reported",
      conversationId,
      turnId,
      message: event.detail ? `${event.stage}: ${event.detail}` : event.stage,
      occurredAt: Date.now(),
    });
  };

  /**
   * `gh pr create` prints the URL of the PR it just opened. THAT is the PR that
   * was opened — not whatever URL the model later retyped into its prose.
   *
   * This is a correctness fix, not a cosmetic one. The daily PR cap and the
   * `langy.github.pr_opened` audit log both used to be reconciled against
   * `extractOpenedPrLinks(fullText)`, so a model that mangled, truncated or
   * simply forgot the URL corrupted permit accounting and the audit trail. The
   * command's own stdout cannot be misremembered.
   */
  const recordOpenedPrs = async (output: string | undefined) => {
    for (const link of extractGithubPrLinks(output ?? "")) {
      if (openedPrLinks.some((seen) => seen.url === link.url)) continue;
      openedPrLinks.push(link);

      // Enrich from GitHub — by US, with the user's token, off the identity the
      // command's own stdout just gave us. NOT by asking the model to run a
      // second command and hoping it remembers (`gh pr create` has no `--json`,
      // so that design would put the model back in the protocol). Best-effort:
      // a token that expired or a repo that went private says nothing about
      // whether the PR exists, so a failure degrades to the bare link rather
      // than to an error where a pull request should be.
      const details = hasGithubToken
        ? await fetchGithubPrDetails({
            token: (credentials as { githubToken: string }).githubToken,
            owner: link.owner,
            repo: link.repo,
            number: link.number,
            url: link.url,
            fetchImpl: deps.fetchImpl,
          })
        : null;

      // The card's source of truth is a DURABLE TOOL PART, not the assistant's
      // prose. Carried in `toolCalls`, it is persisted by `finalizeTurn` and
      // mirrored onto the live buffer — so the PR card streams in during the turn
      // AND survives a refresh, and nothing has to scrape the model's text.
      const toolCallId = `${link.owner}/${link.repo}#${link.number}`;
      const card: GithubPrCardData = details ?? { ...link, state: "open" };
      toolCalls.set(toolCallId, {
        id: toolCallId,
        name: LANGY_OPEN_PR_TOOL,
        input: { repo: `${link.owner}/${link.repo}`, number: link.number },
        output: JSON.stringify(card),
      });

      await deps.conversations.recordToolCallCompleted({
        projectId,
        conversationId,
        turnId,
        toolCallId,
        toolName: LANGY_OPEN_PR_TOOL,
      });
      await deps.buffer
        .appendTool({
          conversationId,
          turnId,
          id: toolCallId,
          name: LANGY_OPEN_PR_TOOL,
          phase: "end",
          output: JSON.stringify(card),
        })
        .catch(() => {});
      await deps.buffer.appendMilestone({
        conversationId,
        turnId,
        kind: "pr_opened",
        detail: toolCallId,
      });
    }
  };

  /**
   * ONE pass at the manager: POST, bridge the NDJSON, and either return the
   * ADR-048 handoff token (or null for a clean finish) or THROW the classified
   * failure. Idempotent to call again ONLY when it produced no output — which
   * `resolveServerRecovery` enforces before it lets us round again.
   */
  const postTurnToManager = async () =>
    doFetch(`${deps.agentUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${deps.internalSecret}`,
      },
      body: JSON.stringify({
        conversationId,
        // turnId + projectId ride the payload so the agent can echo them on its
        // durable final POST to langy-internal (the idempotency key + the tenant
        // the ingest dispatches the finalize command against).
        turnId,
        projectId,
        prompt,
        system,
        credentials,
        ...(modelOverride ? { modelOverride } : {}),
        // ADR-048: resume from a prior turn's checkpoint if one is pending.
        ...(resumeToken ? { resumeToken } : {}),
      }),
      signal: AbortSignal.timeout(AGENT_CHAT_TIMEOUT_MS),
    });

  const attemptManagerTurn = async (): Promise<string | null> => {
    let agentResponse = await postTurnToManager();

    // 428 CREDENTIALS REQUIRED — the designed resolution of a race, not a fault.
    //
    // The route asks the manager whether a live worker already exists before it
    // mints a session key, because a reused worker keeps the key it booted with
    // and a second one would be minted, never read, and left valid for hours. The
    // worker can die in the gap between that probe and this turn: the manager then
    // has to SPAWN, a spawn needs a key, and this turn arrived without one.
    //
    // So we mint here, once, and retry. Bounded deliberately — `hasRemintedKey`
    // means a manager that keeps demanding credentials cannot make us mint in a
    // loop, which would be a credential-generating DoS wearing a retry's clothes.
    // No key came with this turn, so nothing has been consumed and the retry is a
    // clean first attempt, not a duplicate.
    if (
      agentResponse.status === HTTP_CREDENTIALS_REQUIRED &&
      !hasRemintedKey &&
      !credentials.langwatchApiKey
    ) {
      void agentResponse.body?.cancel();
      hasRemintedKey = true;
      turnLogger.info(
        { conversationId },
        "manager needs a session key (worker died after the probe) — minting once and retrying",
      );
      const minted = await mintLangySessionApiKeyForUser({
        prisma,
        userId: job.actorUserId,
        projectId,
        organizationId: credentials.organizationId,
      });
      credentials.langwatchApiKey = minted.token;
      credentials.langwatchApiKeyId = minted.apiKeyId;
      agentResponse = await postTurnToManager();
    }

    if (!agentResponse.ok || !agentResponse.body) {
      void agentResponse.body?.cancel();
      // A non-2xx (or a 2xx with no body) means the manager can't serve this
      // turn: down, mid-deploy, misconfigured, or refusing it. The status is the
      // only detail that crosses to the browser; the message stays in the log.
      throw new LangyAgentUnavailableError(
        `manager responded ${agentResponse.status}`,
        agentResponse.ok ? {} : { status: agentResponse.status },
      );
    }

    const reader = agentResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hardError: string | null = null;
    let handoffToken: string | null = null;

    const handleLine = async (line: string) => {
      const parsed = parseAgentLine(line);
      if (!parsed) return;
      if (parsed.fastToken) {
        // Stream B: raw token straight onto the ephemeral fast channel. Never
        // awaited into the durable critical path and never allowed to throw.
        void deps.fastPublisher
          .publishToken({ conversationId, turnId, text: parsed.fastToken })
          .catch(() => undefined);
        return;
      }
      if (parsed.progress) {
        // A heartbeat frame: refresh the turn's liveness key so a long silent
        // tool call keeps the per-turn reconcile reactor from failing a live
        // turn. Ephemeral and best-effort — never awaited into the critical path.
        void deps.buffer
          .heartbeat({ conversationId, turnId })
          .catch(() => undefined);
        return;
      }
      if (parsed.error) {
        hardError = parsed.error;
        return;
      }
      if (parsed.handoff !== undefined) {
        // ADR-048: the turn checkpointed on manager shutdown. Capture the opaque
        // resume token; the stream ends on this terminal frame.
        handoffToken = parsed.handoff;
        return;
      }
      if (parsed.tool) {
        await handleTool(parsed.tool);
        return;
      }
      if (parsed.delta) {
        fullText += parsed.delta;
        await deps.buffer.appendChunk({
          conversationId,
          turnId,
          text: parsed.delta,
        });
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        await handleLine(line);
      }
    }
    if (buffer.trim()) await handleLine(buffer);

    if (hardError) {
      // The manager's typed frames (`at-capacity`, `session-not-found`) become
      // the matching domain error; any other frame stays an opaque Error whose
      // text only ever reaches the log.
      throw langyAgentErrorFromFrame(hardError);
    }
    return handoffToken;
  };

  /**
   * SERVER-SIDE RECOVERY. Some failures this process can simply fix by having
   * another go, and doing it HERE is strictly better than bouncing them to the
   * browser: the user's message is never re-posted (so it cannot be duplicated),
   * no PR permit is re-reserved, the busy-guard is never re-crossed, and the
   * already-open stream just keeps streaming. The user sees a calm status line,
   * not an error card, and never has to re-ask.
   *
   * Only failures that emitted NOTHING are retried (see `resolveServerRecovery`)
   * — a turn that already streamed prose or ran a tool is terminal here, because
   * replaying it could duplicate an answer or a side effect. `langy_turn_timeout`
   * and `langy_worker_restarting` are deliberately NOT recovered here either
   * (the browser's attach budget is spent / this process is dying); the client
   * policy owns those two.
   */
  const runWithServerRecovery = async (): Promise<string | null> => {
    const startedAt = Date.now();
    let attemptsUsed = 0;
    for (;;) {
      try {
        return await attemptManagerTurn();
      } catch (error) {
        const { kind } = classifyLangyTurnError(error);
        const decision = resolveServerRecovery({
          kind,
          attemptsUsed,
          elapsedMs: Date.now() - startedAt,
          producedOutput: fullText.length > 0 || toolCalls.size > 0,
        });
        if (!decision.retry) {
          turnLogger.debug(
            { kind, attemptsUsed, reason: decision.reason },
            "langy turn not recovered in process — surfacing to the client",
          );
          throw error;
        }
        attemptsUsed++;
        turnLogger.info(
          { kind, attempt: attemptsUsed, delayMs: decision.delayMs },
          "langy turn failed recoverably — retrying in process",
        );
        // Tell the user what is happening on the SAME stream they are already
        // watching. Strictly best-effort, and guarded with a real try/catch
        // rather than a trailing `.catch()`: the latter cannot catch a
        // SYNCHRONOUS throw, which would abort a retry that was about to work.
        try {
          await deps.buffer.appendStatus({
            conversationId,
            turnId,
            status: decision.status,
          });
        } catch (statusError) {
          turnLogger.debug(
            { statusError },
            "failed to publish recovery status",
          );
        }
        await doSleep(decision.delayMs);
      }
    }
  };

  try {
    const handoffToken = await runWithServerRecovery();

    if (handoffToken !== null) {
      // ADR-048: the worker handed off mid-turn on pod shutdown. Persist the
      // opaque resume token durably (conversation_handoff_pending) so the next
      // turn resumes from the checkpoint. Do NOT finalize — the turn did not
      // complete; recordTurnHandoff clears the fold's CurrentTurnId so the
      // conversation is not left "running".
      await deps.conversations.recordTurnHandoff({
        projectId,
        conversationId,
        turnId,
        token: handoffToken,
      });
      await deps.buffer.markEnd({ conversationId, turnId });
      // The turn paused for handoff — return the reserved PR permit so the pause
      // does not burn the user's daily slot; the resumed turn re-reserves its own.
      await releasePermitIfReserved({ job, log: turnLogger, context: "handoff" });
      turnLogger.info(
        "langy turn handed off — checkpoint persisted for resume",
      );
      return;
    }

    // Terminal: the whole final answer is the durable source of truth; tokens
    // were never events. Sentinels are stripped from the persisted body. Tool
    // calls this turn ran are carried as parts BEFORE the text so a refreshed
    // client replays the tool cards in order, then the prose (event-driven
    // recovery). The part shape matches the AI-SDK tool part the live stream
    // emits, so the SAME renderer draws them live and on reload.
    await deps.conversations.finalizeTurn({
      projectId,
      conversationId,
      turnId,
      // Shared with the durable HTTP-final ingest (langy-internal) so whichever
      // path finalizes first produces identical parts and the turnId-idempotent
      // dedupe is content-safe.
      parts: buildFinalAssistantParts({
        text: fullText,
        toolCalls: [...toolCalls.values()],
      }),
      outcome: "completed",
    });
    await deps.buffer.markEnd({ conversationId, turnId });
    // Close Stream B's fast channel so any attached SSE ends promptly and hands
    // off to the reconciled final answer (Stream A). Best-effort — ephemeral.
    await deps.fastPublisher
      .publishEnd({ conversationId, turnId })
      .catch(() => undefined);

    // GitHub-PR permit reconcile + audit — moved here from the old synchronous
    // route's stream executor `finally` (ADR-044). The reserve happened on the
    // route (gate-keeping GH_TOKEN before spawn); reconcile is per-PR, not
    // per-turn: bump the daily counter by any EXTRA PRs a runaway turn opened,
    // and release the slot when the turn opened none. Preserves the
    // release-only-if-`permitReserved` latch (the erosion-via-blip cap-bypass).
    await reconcilePrPermit({ job, openedPrLinks, turnLogger });

    turnLogger.info("langy turn completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    turnLogger.warn({ error: message }, "langy turn failed");
    // Terminal failure with no answer to carry -> agent_turn_failed.
    try {
      await deps.conversations.failTurn({
        projectId,
        conversationId,
        turnId,
        // The CLASSIFIED error, not the raw message. `LastError` is read back on
        // history load and rendered, so it must carry only what the taxonomy has
        // vetted for the wire (a kind + safe meta) — never the manager's internal
        // text. The raw message stays in the log line above, where it belongs.
        error: serializeLangyTurnError(error),
      });
    } catch (dispatchError) {
      turnLogger.error({ error: dispatchError }, "failed to dispatch failTurn");
    }
    // The buffer error entry carries the CLASSIFIED domain error (not the raw
    // message) so `attachTurnStream` emits a structured error PART the browser
    // renders as an error card naming what actually happened — at-capacity,
    // timeout, unreachable — while the raw detail stays in the log above.
    await deps.buffer
      .markError({
        conversationId,
        turnId,
        error: serializeLangyTurnError(error),
      })
      .catch(() => {});
    // End Stream B too so the fast SSE stops waiting and the browser settles on
    // the durable error state (Stream A).
    await deps.fastPublisher
      .publishEnd({ conversationId, turnId })
      .catch(() => undefined);
    // A failed turn opened no PR — return the reserved permit so a read-only /
    // failed chat doesn't burn the user's daily slot.
    await releasePermitIfReserved({ job, log: turnLogger, context: "failure" });
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Reconcile the per-turn GitHub-PR permit against the PRs the turn actually
 * opened, and audit each. Idempotent-ish and isolated so a reconcile failure
 * never masks a completed turn.
 */
async function reconcilePrPermit({
  job,
  openedPrLinks,
  turnLogger,
}: {
  job: LangyTurnJobData;
  /** PRs read from `gh pr create` stdout — the commands' own output. */
  openedPrLinks: GithubPrLink[];
  turnLogger: ReturnType<typeof logger.child>;
}): Promise<void> {
  try {
    const links = openedPrLinks;
    if (links.length === 0) {
      // No PR opened — return the reserved slot.
      if (job.permitReserved) {
        await releaseLangyGithubPrPermit({ userId: job.actorUserId });
      }
      return;
    }
    // PR(s) opened — the up-front permit is consumed (do NOT release). If more
    // than one landed, bump the daily counter by the remaining N-1 so the cap
    // is per-PR, not per-turn (release-only-if-reserved preserved).
    if (links.length > 1 && job.permitReserved) {
      await recordExtraLangyGithubPrs({
        userId: job.actorUserId,
        extra: links.length - 1,
      });
    }
    for (const link of links) {
      await auditLog({
        userId: job.actorUserId,
        projectId: job.projectId,
        action: "langy.github.pr_opened",
        args: {
          owner: link.owner,
          repo: link.repo,
          number: link.number,
          url: link.url,
        },
      });
    }
  } catch (error) {
    turnLogger.error({ error }, "failed to reconcile langy github PR permit");
  }
}

/** Build the production run-turn deps from the app + env + Redis. */
function createRunTurnDeps(): RunTurnDeps | null {
  const agentUrl = process.env.OPENCODE_AGENT_URL;
  const internalSecret = process.env.LANGY_INTERNAL_SECRET;
  if (!agentUrl || !internalSecret || !connection) {
    logger.info(
      {
        hasAgentUrl: !!agentUrl,
        hasSecret: !!internalSecret,
        hasRedis: !!connection,
      },
      "Langy turn processor missing config — spawn function will no-op",
    );
    return null;
  }
  // A dedicated blocking connection for XREAD BLOCK follow reads on the reader
  // side; the writer side (this processor) only XADDs, so it uses the shared
  // connection directly.
  const buffer = createLangyTokenBuffer({ redis: connection });
  const ephemeral = new RedisLangyEphemeralPublisher(buffer);
  // Stream B publisher rides the shared connection — publish is a plain
  // fire-and-forget command (no blocking reads), so no dedicated connection.
  const fastPublisher = new LangyFastTokenPublisher(connection);
  return {
    conversations: getApp().langy.conversations,
    ephemeral,
    buffer,
    fastPublisher,
    agentUrl,
    internalSecret,
  };
}

/**
 * Start the Langy turn processor: wire the pool spawn function, boot + schedule
 * the reconcile sweep, and return a shutdown handle. Returns undefined when
 * Redis / manager config is absent (mirrors `startScenarioProcessor`).
 */
export async function startLangyTurnProcessor(
  pool: LangyWorkerPool,
  overrides?: {
    runTurnDeps?: RunTurnDeps;
    reconcilerDeps?: LangyTurnReconcilerDeps;
  },
): Promise<{ close: () => Promise<void> } | undefined> {
  if (!connection) {
    logger.info("No Redis connection, skipping langy turn processor");
    return undefined;
  }

  const deps = overrides?.runTurnDeps ?? createRunTurnDeps();
  if (!deps) return undefined;

  pool.setSpawnFunction((job) => runTurn(job, deps));

  const reconcilerDeps: LangyTurnReconcilerDeps = overrides?.reconcilerDeps ?? {
    buffer: deps.buffer,
    conversations: deps.conversations,
  };

  // Boot sweep + periodic sweep. Fire-and-forget so a slow ClickHouse scan
  // never wedges worker startup.
  const runSweep = () =>
    reconcileLangyTurns(reconcilerDeps).catch((err) =>
      logger.warn({ err }, "langy reconcile sweep failed"),
    );
  void runSweep();
  const sweepInterval = setInterval(
    () => void runSweep(),
    LANGY_LIVENESS.SWEEP_INTERVAL_MS,
  );

  logger.info("Langy turn processor started (event-driven)");

  return {
    close: async () => {
      clearInterval(sweepInterval);
      // Emit a terminal failure for every in-flight turn so a deploy mid-turn
      // does not orphan turns in-flight (deploy-survival, mirror drainInFlightRuns).
      const handoffStore = createLangyTurnHandoffStore({ redis: connection! });
      void handoffStore; // reserved: retry path would re-stash here in future
      await pool.drain(async (job) => {
        // A known, nameable failure — not an "unexpected error". The browser
        // gets `langy_worker_restarting`, and the recovery policy re-drives the
        // turn on its own (features/langy/logic/langyRecoveryPolicy.ts) so a
        // deploy never costs the user their question.
        const restarting = new LangyWorkerRestartingError();
        await deps.conversations.failTurn({
          projectId: job.projectId,
          conversationId: job.conversationId,
          turnId: job.turnId,
          error: serializeLangyTurnError(restarting),
        });
        await deps.buffer
          .markError({
            conversationId: job.conversationId,
            turnId: job.turnId,
            error: serializeLangyTurnError(restarting),
          })
          .catch(() => {});
        // Return the reserved PR permit, exactly as the failure and handoff
        // paths in runTurn do. A drained turn opened no PR, and the turn the
        // browser retries reserves its OWN permit — without this release, every
        // deploy-interrupted turn silently ate one of the user's daily slots, and
        // the auto-retry would eat a second on top.
        await releasePermitIfReserved({ job, log: logger, context: "drain" });
      });
    },
  };
}

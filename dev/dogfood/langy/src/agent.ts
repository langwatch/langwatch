/**
 * Langy connected to Agent Testing exactly as a customer connects their agent: `connectAgent`,
 * turns over Langy's public REST surface, setup and teardown hooks (ADR-180) for the test data.
 * README.md has the environment and the feature gaps this surfaced.
 */
import { getLangWatchTracer } from "langwatch";
import { connectAgent, MAX_TIMEOUT_MS, type ScenarioState } from "langwatch/agent";
import { setupObservability } from "langwatch/observability/node";

import { createLangWatchHttp, readConfig } from "./http.ts";
import {
  isLoginWorldState,
  loginAdviceIn,
  setupLoginWorld,
  teardownLoginWorld,
} from "./login-world.ts";
import { isPromptWorldState, setupPromptWorld, teardownPromptWorld } from "./prompt-world.ts";
import {
  isQuietWorldState,
  readQuietFacts,
  setupQuietWorld,
  teardownQuietWorld,
} from "./quiet-world.ts";
import {
  isTopicWorldState,
  readTopicFacts,
  setupTopicWorld,
  teardownTopicWorld,
} from "./topic-world.ts";
import { askLangy, latestUserText } from "./turn.ts";
import {
  isMatrixWorld,
  LOGIN_WORLD,
  parseWorld,
  PROMPT_WORLD,
  QUIET_WORLD,
  TOPIC_WORLD,
  WORLD_NAMES,
} from "./world-names.ts";
import { readFacts, setupWorld, teardownWorld, type WorldState } from "./worlds.ts";

const config = readConfig({ env: process.env });
const http = createLangWatchHttp({ config });

// The judge grades writes only against the agent's spans, so the turn and the facts are traced.
setupObservability({
  serviceName: "langy-connector",
  langwatch: { apiKey: config.apiKey, endpoint: config.endpoint, processorType: "simple" },
});
const tracer = getLangWatchTracer("langy-connector");

const toState = (value: object): ScenarioState => value as ScenarioState;
const worldStateOf = (state: ScenarioState | null): WorldState | null =>
  state && isMatrixWorld(state.world) ? (state as unknown as WorldState) : null;

/** The code-check facts of the world after a reply; null for the prompt world, which has none. */
async function factsOf(state: ScenarioState | null, reply: string): Promise<object | null> {
  const world = worldStateOf(state);
  if (world) return readFacts({ http, state: world });
  if (isTopicWorldState(state)) return readTopicFacts({ http, state });
  if (isQuietWorldState(state)) return readQuietFacts({ http, state });
  if (isLoginWorldState(state)) return { login_advice: loginAdviceIn({ text: reply }) };
  return null;
}

export const langy = connectAgent(
  {
    name: "langy",
    apiKey: config.apiKey,
    endpoint: config.endpoint,
    projectId: config.projectId,
    timeoutMs: MAX_TIMEOUT_MS,
    parameters: {
      world: {
        default: PROMPT_WORLD,
        description: `The test world setup builds: ${WORLD_NAMES.join(", ")}`,
      },
    },
  },
  async ({ messages, newMessages, threadId, state }) => {
    const turn = messages.filter((message) => message.role === "user").length;
    const text = latestUserText({ newMessages, messages });
    const reply = await tracer.withActiveSpan(
      "langy.turn (POST /api/langy/conversations)",
      async (span) => {
        span.setType("agent").setInput("text", text);
        const answer = await askLangy({
          http,
          conversationId: threadId,
          text,
          idempotencyKey: `${threadId}-turn-${turn}`,
        });
        span.setOutput("text", answer.text);
        return answer;
      },
    );
    // The judge grades the world, not only the words: the facts ride in the state and a span.
    const facts = await tracer.withActiveSpan(
      "world.facts (public API read after the turn)",
      async (span) => {
        span.setType("tool").setInput("text", "the world's state, read from the public API");
        const read = await factsOf(state, reply.text);
        span.setOutput("raw", read);
        return read;
      },
    );
    if (!facts) return reply.text;
    const before = (state?.facts_after_turn ?? {}) as Record<string, unknown>;
    return {
      output: reply.text,
      state: {
        ...state,
        facts_after_turn: { ...before, [String(turn)]: facts },
        facts_now: facts,
        langy_conversation_id: reply.conversationId,
      },
    };
  },
);

langy.scenario.setup(async (run, params) => {
  const world = parseWorld({ value: params.world });
  if (isMatrixWorld(world)) return toState(await setupWorld({ http, world }));
  if (world === TOPIC_WORLD) return toState(await setupTopicWorld({ http }));
  if (world === QUIET_WORLD) return toState(await setupQuietWorld({ http }));
  if (world === LOGIN_WORLD) return toState(setupLoginWorld());
  if (process.env.LANGY_DOGFOOD_FAIL_SETUP === "1") {
    throw new Error("setup failed on purpose (LANGY_DOGFOOD_FAIL_SETUP=1)");
  }
  return toState(await setupPromptWorld({ http, scenarioRunId: run.scenarioRunId ?? "unknown" }));
});

langy.scenario.teardown(async (_run, state) => {
  const world = worldStateOf(state);
  if (world) return toState(await teardownWorld({ http, state: world }));
  if (isTopicWorldState(state)) return toState(await teardownTopicWorld({ http, state }));
  if (isQuietWorldState(state)) return toState(await teardownQuietWorld({ http, state }));
  if (isLoginWorldState(state)) return toState(teardownLoginWorld({ state }));
  if (isPromptWorldState(state)) return toState(await teardownPromptWorld({ http, state }));
  return { deleted: {}, left_behind: {} };
});

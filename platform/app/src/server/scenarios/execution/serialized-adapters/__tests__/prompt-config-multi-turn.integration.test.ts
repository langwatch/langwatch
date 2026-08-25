/**
 * @vitest-environment node
 *
 * Multi-turn regression for #6590 / #6594.
 *
 * Drives the real `SerializedPromptConfigAdapter` through the real
 * `createModelFromParams` client against a local server standing in for the
 * gateway proxy, and reproduces the scenario loop exactly as the SDK
 * implements it: the adapter's returned string becomes the next
 * `{ role: "assistant", content }`, and every message carries the `id` and
 * `traceId` `ScenarioState.addMessage` stamps on it.
 *
 * The model here replies with whatever it was shown — which is what the
 * reported run's model did, and what makes the compounding observable. On
 * `main` (a09e7c72f) this measured:
 *
 *   turn 1   319 B    turn 4  4630 B   (×14.5), each turn's rendered prompt
 *   containing the previous turn's verbatim, JSON-escaped one level deeper
 *   every turn.
 *
 * A control arm with a model that answers normally grew 319 → 1141 B with no
 * embedding at all, which is what rules out "conversations just get longer" as
 * the explanation.
 *
 * Covers the @integration scenarios in
 * specs/scenarios/prompt-agent-input-binding.feature.
 */

import { createServer, type Server } from "node:http";
import type { Logger } from "@langwatch/observability";
import type { AgentInput } from "@langwatch/scenario";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiteLLMParams, PromptConfigData } from "../../types";
import { SerializedPromptConfigAdapter } from "../prompt-config.adapter";

const LITELLM_PARAMS: LiteLLMParams = {
  api_key: "test-key",
  model: "openai/gpt-5-mini",
};

interface StubModel {
  url: string;
  systemPrompts: () => string[];
  requestBytes: () => number[];
  close: () => Promise<void>;
}

/**
 * Answers with the system prompt it was handed, reproducing the reported
 * model's behaviour: shown a serialised payload, it returns one.
 */
async function startEchoingModel(): Promise<StubModel> {
  const systemPrompts: string[] = [];
  const requestBytes: number[] = [];

  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
    req.on("end", () => {
      requestBytes.push(Buffer.byteLength(raw));
      const body = JSON.parse(raw) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      const systemPrompt = body.messages.find((m) => m.role === "system")?.content ?? "";
      systemPrompts.push(systemPrompt);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-stub",
          object: "chat.completion",
          created: 0,
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: systemPrompt },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}`,
    systemPrompts: () => systemPrompts,
    requestBytes: () => requestBytes,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Runs `turns` turns the way the scenario executor does. */
async function runTurns(
  adapter: SerializedPromptConfigAdapter,
  turns: number,
): Promise<void> {
  let sequence = 0;
  const stamp = (message: { role: string; content: string }) => ({
    ...message,
    id: `scnmsg_${++sequence}`,
    traceId: `trace_${sequence}`,
  });

  const conversation: Array<Record<string, unknown>> = [
    stamp({ role: "user", content: "I need a refund" }),
  ];

  for (let turn = 1; turn <= turns; turn++) {
    const reply = await adapter.call({
      threadId: "thread_abc123",
      messages: conversation,
      newMessages: [conversation[conversation.length - 1]],
      requestedRole: "agent",
      scenarioState: {},
      scenarioConfig: {},
    } as unknown as AgentInput);

    conversation.push(stamp({ role: "assistant", content: reply }));
    conversation.push(
      stamp({ role: "user", content: `Follow-up number ${turn}, please.` }),
    );
  }
}

let model: StubModel | undefined;

afterEach(async () => {
  await model?.close();
  model = undefined;
});

describe("prompt agent over four turns", () => {
  describe("given a template that reads the conversation history", () => {
    describe("when the model replies with whatever it was shown", () => {
      // The payload is the serialised conversation. A model that reproduces
      // what it was shown cannot be stopped from putting its last reply into
      // the next turn's history — that is the conversation. What the adapter
      // controls, and what made the reported run compound, is whether the
      // thing being reproduced is a JSON array that gets re-serialised and
      // re-escaped every turn.
      /** @scenario "Turn N's request does not embed turn N-1's rendered payload" */
      it("never shows the model a serialised conversation payload", async () => {
        model = await startEchoingModel();
        const config: PromptConfigData = {
          type: "prompt",
          promptId: "prompt_repro",
          systemPrompt: [
            "You are a support agent. Answer the customer.",
            "question: {{question}}",
            "thread_id: {{thread_id}}",
            "messages: {{messages}}",
          ].join("\n"),
          messages: [],
          inputs: [
            { identifier: "question", type: "str" },
            { identifier: "thread_id", type: "str" },
          ],
        };

        await runTurns(
          new SerializedPromptConfigAdapter({
            config: config,
            litellmParams: LITELLM_PARAMS,
            nlpServiceUrl: model.url,
          }),
          4,
        );

        const prompts = model.systemPrompts();
        expect(prompts).toHaveLength(4);
        for (const [index, prompt] of prompts.entries()) {
          expect(prompt, `turn ${index + 1} carries a JSON message array`).not.toMatch(
            /"role"\s*:/,
          );
          // An escaped quote is the tell of a payload nested inside a payload:
          // it is what the escape depth climbed through on `main`, turn by turn.
          expect(prompt, `turn ${index + 1} nests an escaped payload`).not.toContain(
            '\\"',
          );
        }
      });

      /** @scenario "Turn N's request does not embed turn N-1's rendered payload" */
      it("does not re-serialise history that a mapped input reads", async () => {
        model = await startEchoingModel();
        const config: PromptConfigData = {
          type: "prompt",
          promptId: "prompt_repro",
          systemPrompt: "Prior turns:\n{{history}}",
          messages: [],
          inputs: [{ identifier: "history", type: "str" }],
          scenarioMappings: {
            history: {
              type: "source",
              sourceId: "scenario",
              path: ["messages"],
            },
          },
        };

        await runTurns(
          new SerializedPromptConfigAdapter({
            config: config,
            litellmParams: LITELLM_PARAMS,
            nlpServiceUrl: model.url,
          }),
          4,
        );

        for (const [index, prompt] of model.systemPrompts().entries()) {
          expect(prompt, `turn ${index + 1}`).not.toMatch(/"role"\s*:/);
          expect(prompt, `turn ${index + 1}`).not.toContain('\\"');
        }
      });

      /** @scenario "Internal message fields never reach prompt text" */
      it("never puts the runner's id or traceId in prompt text", async () => {
        model = await startEchoingModel();
        const config: PromptConfigData = {
          type: "prompt",
          promptId: "prompt_repro",
          systemPrompt: "History: {{messages}}",
          messages: [],
          inputs: [],
        };

        await runTurns(
          new SerializedPromptConfigAdapter({
            config: config,
            litellmParams: LITELLM_PARAMS,
            nlpServiceUrl: model.url,
          }),
          4,
        );

        for (const prompt of model.systemPrompts()) {
          expect(prompt).not.toContain("traceId");
          expect(prompt).not.toContain("scnmsg_");
        }
      });

      /** @scenario "A declared input is bound by name to a scenario source" */
      it("binds the declared inputs on every turn", async () => {
        model = await startEchoingModel();
        const config: PromptConfigData = {
          type: "prompt",
          promptId: "prompt_repro",
          systemPrompt: "question: {{question}}\nthread_id: {{thread_id}}",
          messages: [],
          inputs: [
            { identifier: "question", type: "str" },
            { identifier: "thread_id", type: "str" },
          ],
        };

        await runTurns(
          new SerializedPromptConfigAdapter({
            config: config,
            litellmParams: LITELLM_PARAMS,
            nlpServiceUrl: model.url,
          }),
          4,
        );

        expect(model.systemPrompts()[0]).toBe(
          "question: I need a refund\nthread_id: thread_abc123",
        );
        expect(model.systemPrompts()[3]).toBe(
          "question: Follow-up number 3, please.\nthread_id: thread_abc123",
        );
      });
    });
  });

  describe("given a declared input the simulation has nothing to bind to", () => {
    describe("when the agent takes a turn", () => {
      /** @scenario "An unbindable input is reported on the run" */
      it("reports the unbound input by name and never records a value", async () => {
        model = await startEchoingModel();
        const warn = vi.fn();
        const config: PromptConfigData = {
          type: "prompt",
          promptId: "prompt_repro",
          systemPrompt: "question: {{question}}\ntier: {{customer_tier}}",
          messages: [],
          inputs: [
            { identifier: "question", type: "str" },
            { identifier: "customer_tier", type: "str" },
          ],
        };

        await runTurns(
          new SerializedPromptConfigAdapter({
            config: config,
            litellmParams: LITELLM_PARAMS,
            nlpServiceUrl: model.url,
            logger: {
              warn,
            } as unknown as Logger,
          }),
          1,
        );

        expect(warn).toHaveBeenCalledTimes(1);
        const [fields, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
        expect(fields.unboundInputs).toEqual(["customer_tier"]);
        expect(fields.promptId).toBe("prompt_repro");
        // Names only — the bound values never reach the log line.
        expect(JSON.stringify([fields, message])).not.toContain("I need a refund");
        // The rendered prompt shows the placeholder where the value would be.
        expect(model.systemPrompts()[0]).toContain(
          "tier: [unbound input: customer_tier]",
        );
      });
    });
  });
});

import { describe, it, expect } from "vitest";
import { AgentRole, type AgentInput } from "@langwatch/scenario";
import {
  createOpenCodeAgent,
  partsToText,
  type OpenCodeServerHandle,
} from "./helpers/opencode-adapter";
import { renderContent } from "./helpers/render-content";

/**
 * Builds a fake opencode server handle plus spies, so the adapter can be
 * exercised with no real server and no network. `session.create` hands back an
 * incrementing `sess-N` id and records each created title; `session.prompt`
 * records the call options and returns a single "reply" text part.
 */
function makeFakeServer(
  promptImpl?: (options: any) => Promise<{ data?: { parts?: unknown[] } }>
): {
  handle: OpenCodeServerHandle;
  created: string[];
  prompts: any[];
  closeCount: { value: number };
} {
  const created: string[] = [];
  const prompts: any[] = [];
  const closeCount = { value: 0 };
  let counter = 0;

  const handle: OpenCodeServerHandle = {
    client: {
      session: {
        create: async (options) => {
          counter += 1;
          created.push(options?.body?.title ?? "");
          return { data: { id: `sess-${counter}` } };
        },
        prompt: async (options) => {
          prompts.push(options);
          return promptImpl
            ? promptImpl(options)
            : { data: { parts: [{ type: "text", text: "reply" }] } };
        },
      },
    },
    close: () => {
      closeCount.value += 1;
    },
  };

  return { handle, created, prompts, closeCount };
}

/**
 * Builds a minimal `AgentInput` for unit tests. Only the fields the adapter
 * reads (threadId, messages, newMessages) need to be present; the rest of the
 * interface is satisfied by the cast.
 */
function makeInput({
  threadId,
  messages = [],
  newMessages = [],
}: {
  threadId: string;
  messages?: { role: string; content: unknown }[];
  newMessages?: { role: string; content: unknown }[];
}): AgentInput {
  return { threadId, messages, newMessages } as unknown as AgentInput;
}

describe("createOpenCodeAgent", () => {
  describe("given a model and an injected fake server", () => {
    describe("when the adapter is constructed", () => {
      it("exposes the agent role and a call function (AC-1)", () => {
        const { handle } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        expect(agent.role).toBe(AgentRole.AGENT);
        expect(typeof agent.call).toBe("function");
      });
    });

    describe("when called twice on the same thread", () => {
      it("creates the session once and reuses its id (AC-2)", async () => {
        const { handle, created, prompts } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        await agent.call(
          makeInput({
            threadId: "thread-1",
            newMessages: [{ role: "user", content: "first" }],
          })
        );
        await agent.call(
          makeInput({
            threadId: "thread-1",
            newMessages: [{ role: "user", content: "second" }],
          })
        );

        expect(created).toHaveLength(1);
        expect(prompts).toHaveLength(2);
        expect(prompts[0].path.id).toBe("sess-1");
        expect(prompts[1].path.id).toBe("sess-1");
      });
    });

    describe("when called on two different threads", () => {
      it("creates a separate session per thread (AC-2)", async () => {
        const { handle, created, prompts } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        await agent.call(
          makeInput({
            threadId: "thread-1",
            newMessages: [{ role: "user", content: "hi" }],
          })
        );
        await agent.call(
          makeInput({
            threadId: "thread-2",
            newMessages: [{ role: "user", content: "hi" }],
          })
        );

        expect(created).toHaveLength(2);
        expect(prompts[0].path.id).toBe("sess-1");
        expect(prompts[1].path.id).toBe("sess-2");
      });
    });

    describe("when create returns no session id", () => {
      it("throws a descriptive error (AC-2)", async () => {
        const { handle } = makeFakeServer();
        handle.client.session.create = async () => ({ data: undefined });
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        await expect(
          agent.call(
            makeInput({
              threadId: "thread-1",
              newMessages: [{ role: "user", content: "hi" }],
            })
          )
        ).rejects.toThrow(/no session id/);
      });
    });

    describe("when the turn carries user messages", () => {
      it("sends the latest user message as the prompt text (AC-3)", async () => {
        const { handle, prompts } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        await agent.call(
          makeInput({
            threadId: "thread-1",
            newMessages: [
              { role: "user", content: "older" },
              { role: "assistant", content: "ack" },
              { role: "user", content: "latest user message" },
            ],
          })
        );

        expect(prompts[0].body.parts[0]).toEqual({
          type: "text",
          text: "latest user message",
        });
      });

      it("prefers newMessages over older messages (AC-3)", async () => {
        const { handle, prompts } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        await agent.call(
          makeInput({
            threadId: "thread-1",
            messages: [{ role: "user", content: "historical question" }],
            newMessages: [{ role: "user", content: "brand new question" }],
          })
        );

        expect(prompts[0].body.parts[0].text).toBe("brand new question");
      });

      it("falls back to the latest user message in history when newMessages has none (AC-3)", async () => {
        const { handle, prompts } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        await agent.call(
          makeInput({
            threadId: "thread-1",
            messages: [
              { role: "user", content: "the user question" },
              { role: "assistant", content: "an answer" },
            ],
            newMessages: [{ role: "assistant", content: "follow-up only" }],
          })
        );

        expect(prompts[0].body.parts[0].text).toBe("the user question");
      });

      it("returns the assistant reply string (AC-3)", async () => {
        const { handle } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        const reply = await agent.call(
          makeInput({
            threadId: "thread-1",
            newMessages: [{ role: "user", content: "hi" }],
          })
        );

        expect(reply).toBe("reply");
      });

      it("passes the configured model through to prompt (AC-3)", async () => {
        const { handle, prompts } = makeFakeServer();
        const model = { providerID: "openai", modelID: "gpt-5-mini" };
        const agent = createOpenCodeAgent({
          model,
          startServer: async () => handle,
        });

        await agent.call(
          makeInput({
            threadId: "thread-1",
            newMessages: [{ role: "user", content: "hi" }],
          })
        );

        expect(prompts[0].body.model).toEqual(model);
      });

      it("falls back to full history rendering when no user message exists anywhere (AC-3)", async () => {
        const { handle, prompts } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        await agent.call(
          makeInput({
            threadId: "thread-1",
            messages: [
              { role: "system", content: "You are a helpful assistant." },
              { role: "assistant", content: "How can I help?" },
            ],
            newMessages: [],
          })
        );

        const promptText = prompts[0].body.parts[0].text;
        expect(promptText).toContain("assistant: ");
        expect(promptText).toContain("How can I help?");
      });
    });

    describe("when the prompt resolves asynchronously", () => {
      it("waits for completion before returning the full text (AC-4)", async () => {
        let settled = false;
        const { handle } = makeFakeServer(async () => {
          // Defer to a later microtask, then resolve with the full reply. If the
          // adapter returned before awaiting, the text would be missing.
          await Promise.resolve();
          await Promise.resolve();
          settled = true;
          return {
            data: { parts: [{ type: "text", text: "fully generated answer" }] },
          };
        });
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        const reply = await agent.call(
          makeInput({
            threadId: "thread-1",
            newMessages: [{ role: "user", content: "hi" }],
          })
        );

        expect(settled).toBe(true);
        expect(reply).toBe("fully generated answer");
      });
    });

    describe("when called multiple times", () => {
      it("starts the server only once (memoized)", async () => {
        let startCount = 0;
        const { handle } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => {
            startCount += 1;
            return handle;
          },
        });

        await agent.call(
          makeInput({
            threadId: "thread-1",
            newMessages: [{ role: "user", content: "a" }],
          })
        );
        await agent.call(
          makeInput({
            threadId: "thread-2",
            newMessages: [{ role: "user", content: "b" }],
          })
        );

        expect(startCount).toBe(1);
      });
    });

    describe("when close is called", () => {
      it("invokes the handle close exactly once after a call has started the server", async () => {
        const { handle, closeCount } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        await agent.call(
          makeInput({
            threadId: "thread-1",
            newMessages: [{ role: "user", content: "hi" }],
          })
        );

        await agent.close();

        expect(closeCount.value).toBe(1);
      });

      it("does not throw and does not double-close when called again after close", async () => {
        const { handle, closeCount } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        await agent.call(
          makeInput({
            threadId: "thread-1",
            newMessages: [{ role: "user", content: "hi" }],
          })
        );

        await agent.close();
        await agent.close();

        expect(closeCount.value).toBe(1);
      });

      it("does not throw when called before any call has started the server", async () => {
        const { handle } = makeFakeServer();
        const agent = createOpenCodeAgent({
          model: { providerID: "openai", modelID: "gpt-5-mini" },
          startServer: async () => handle,
        });

        await expect(agent.close()).resolves.toBeUndefined();
      });
    });
  });
});

describe("partsToText", () => {
  describe("given a parts array", () => {
    it("concatenates text parts (AC-6)", () => {
      const text = partsToText([
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ]);

      expect(text).toBe("line one\nline two");
    });

    it("skips unknown part types and nullish entries without throwing (AC-6)", () => {
      const text = partsToText([
        { type: "text", text: "keep" },
        { type: "tool", name: "bash" },
        null,
        { type: "file", url: "x" },
        { type: "text", text: "also keep" },
      ]);

      expect(text).toBe("keep\nalso keep");
    });
  });

  describe("given a non-array value", () => {
    it("returns an empty string for undefined (AC-6)", () => {
      expect(partsToText(undefined)).toBe("");
    });

    it("returns an empty string for a non-array object (AC-6)", () => {
      expect(partsToText({ parts: "nope" } as unknown)).toBe("");
    });
  });
});

describe("renderContent", () => {
  describe("given an anthropic content-block array", () => {
    it("flattens text and tool_use blocks to readable text (AC-6)", () => {
      const rendered = renderContent([
        { type: "text", text: "Calling a tool" },
        { type: "tool_use", name: "search", input: { q: "hello" } },
      ]);

      expect(rendered).toBe(
        'Calling a tool\n[tool_use search({"q":"hello"})]'
      );
    });
  });

  describe("given a plain string", () => {
    it("returns it unchanged (AC-6)", () => {
      expect(renderContent("just text")).toBe("just text");
    });
  });
});

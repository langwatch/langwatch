import { describe, expect, it } from "vitest";

import {
  diffPromptVersions,
  type PromptVersionSnapshot,
} from "../promptVersionDiff";

const version = (
  overrides: Partial<PromptVersionSnapshot> = {},
): PromptVersionSnapshot => ({
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "{{question}}" },
  ],
  model: "openai/gpt-5-mini",
  temperature: 0.7,
  maxTokens: 512,
  inputs: [{ identifier: "question", type: "str" }],
  outputs: [{ identifier: "answer", type: "str" }],
  ...overrides,
});

describe("diffPromptVersions", () => {
  describe("given the system prompt was rewritten", () => {
    describe("when the two versions are compared", () => {
      it("reports the system prompt as a text change", () => {
        const changes = diffPromptVersions({
          previous: version(),
          version: version({
            messages: [
              { role: "system", content: "You are a terse assistant." },
              { role: "user", content: "{{question}}" },
            ],
          }),
        });

        expect(changes).toHaveLength(1);
        expect(changes[0]).toMatchObject({
          label: "System prompt",
          kind: "text",
          status: "changed",
          before: "You are a helpful assistant.",
          after: "You are a terse assistant.",
        });
      });
    });
  });

  describe("given the model and temperature both moved", () => {
    describe("when the two versions are compared", () => {
      /** @scenario "Changed model and temperature are reported as settings" */
      it("names each setting with its value before and after", () => {
        const changes = diffPromptVersions({
          previous: version(),
          version: version({ model: "anthropic/claude-x", temperature: 0.2 }),
        });

        expect(changes).toEqual([
          {
            key: "model",
            label: "Model",
            kind: "value",
            status: "changed",
            before: "openai/gpt-5-mini",
            after: "anthropic/claude-x",
          },
          {
            key: "temperature",
            label: "Temperature",
            kind: "value",
            status: "changed",
            before: "0.7",
            after: "0.2",
          },
        ]);
      });
    });
  });

  describe("given a message was appended", () => {
    describe("when the two versions are compared", () => {
      /** @scenario "An added message is reported as added" */
      it("reports that message as added", () => {
        const changes = diffPromptVersions({
          previous: version(),
          version: version({
            messages: [
              { role: "system", content: "You are a helpful assistant." },
              { role: "user", content: "{{question}}" },
              { role: "assistant", content: "Sure, here you go." },
            ],
          }),
        });

        expect(changes).toEqual([
          {
            key: "message-2",
            label: "Assistant message",
            kind: "text",
            status: "added",
            before: "",
            after: "Sure, here you go.",
          },
        ]);
      });
    });
  });

  describe("given a message was dropped", () => {
    describe("when the two versions are compared", () => {
      it("reports that message as removed", () => {
        const changes = diffPromptVersions({
          previous: version(),
          version: version({
            messages: [
              { role: "system", content: "You are a helpful assistant." },
            ],
          }),
        });

        expect(changes).toEqual([
          {
            key: "message-1",
            label: "User message",
            kind: "text",
            status: "removed",
            before: "{{question}}",
            after: "",
          },
        ]);
      });
    });
  });

  describe("given a message was inserted ahead of the existing ones", () => {
    describe("when the two versions are compared", () => {
      it("reports one addition rather than every later message changing", () => {
        const changes = diffPromptVersions({
          previous: {
            messages: [
              { role: "user", content: "First" },
              { role: "assistant", content: "Reply" },
            ],
          },
          version: {
            messages: [
              { role: "system", content: "You are a terse assistant." },
              { role: "user", content: "First" },
              { role: "assistant", content: "Reply" },
            ],
          },
        });

        expect(changes).toEqual([
          {
            key: "message-0",
            label: "System prompt",
            kind: "text",
            status: "added",
            before: "",
            after: "You are a terse assistant.",
          },
        ]);
      });
    });
  });

  describe("given the first message was removed", () => {
    describe("when the two versions are compared", () => {
      it("reports one removal rather than every later message changing", () => {
        const changes = diffPromptVersions({
          previous: {
            messages: [
              { role: "system", content: "You are a terse assistant." },
              { role: "user", content: "First" },
              { role: "assistant", content: "Reply" },
            ],
          },
          version: {
            messages: [
              { role: "user", content: "First" },
              { role: "assistant", content: "Reply" },
            ],
          },
        });

        expect(changes).toEqual([
          {
            key: "message-0",
            label: "System prompt",
            kind: "text",
            status: "removed",
            before: "You are a terse assistant.",
            after: "",
          },
        ]);
      });
    });
  });

  describe("given the inputs and outputs changed", () => {
    describe("when the two versions are compared", () => {
      it("lists each field with its type", () => {
        const changes = diffPromptVersions({
          previous: version(),
          version: version({
            inputs: [
              { identifier: "question", type: "str" },
              { identifier: "context", type: "str" },
            ],
          }),
        });

        expect(changes).toEqual([
          {
            key: "inputs",
            label: "Inputs",
            kind: "value",
            status: "changed",
            before: "question (str)",
            after: "question (str), context (str)",
          },
        ]);
      });
    });
  });

  describe("given a version republished the previous version unchanged", () => {
    describe("when the two versions are compared", () => {
      /** @scenario "Two identical versions compare to nothing" */
      it("reports no changes", () => {
        expect(
          diffPromptVersions({ previous: version(), version: version() }),
        ).toEqual([]);
      });
    });
  });

  describe("given several messages share a role", () => {
    describe("when the later one changed", () => {
      it("numbers the label so the reader can tell them apart", () => {
        const messages = [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "first" },
          { role: "assistant", content: "ok" },
          { role: "user", content: "second" },
        ];

        const changes = diffPromptVersions({
          previous: { messages },
          version: {
            messages: messages.map((message, index) =>
              index === 3 ? { ...message, content: "third" } : message,
            ),
          },
        });

        expect(changes[0]?.label).toBe("User message 2");
      });
    });
  });

  describe("given a version carries no content at all", () => {
    describe("when it is compared against a populated version", () => {
      it("does not throw and reports the removals", () => {
        const changes = diffPromptVersions({
          previous: version(),
          version: {},
        });

        expect(changes.map((change) => change.label)).toEqual([
          "System prompt",
          "User message",
          "Model",
          "Temperature",
          "Maximum tokens",
          "Inputs",
          "Outputs",
        ]);
        expect(changes.every((change) => change.status === "removed")).toBe(
          true,
        );
      });
    });
  });
});

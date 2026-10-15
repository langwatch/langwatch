import { describe, expect, it } from "vitest";

import { coerceToChatMessages } from "../chat-message-coercion.ts";
import { extractSystemText } from "../transcript-text-extraction.ts";

// Fixtures are real output of langchain-core 1.x (`dumpd`, `model_dump`, `message_to_dict`).
const DUMPD_BATCH = JSON.stringify({
  messages: [
    [
      {
        lc: 1,
        type: "constructor",
        id: ["langchain", "schema", "messages", "SystemMessage"],
        kwargs: { content: "You are a helpful travel agent.", type: "system" },
      },
      {
        lc: 1,
        type: "constructor",
        id: ["langchain", "schema", "messages", "HumanMessage"],
        kwargs: {
          content: [{ type: "text", text: "What is the weather in Paris?" }],
          type: "human",
        },
      },
      {
        lc: 1,
        type: "constructor",
        id: ["langchain", "schema", "messages", "AIMessage"],
        kwargs: {
          content: "",
          type: "ai",
          tool_calls: [
            { name: "get_weather", args: { city: "Paris" }, id: "call_1", type: "tool_call" },
          ],
          invalid_tool_calls: [],
        },
      },
      {
        lc: 1,
        type: "constructor",
        id: ["langchain", "schema", "messages", "ToolMessage"],
        kwargs: {
          content: "Sunny, 22C",
          type: "tool",
          name: "get_weather",
          tool_call_id: "call_1",
          status: "success",
        },
      },
      {
        lc: 1,
        type: "constructor",
        id: ["langchain", "schema", "messages", "AIMessageChunk"],
        kwargs: {
          content: "It is sunny and 22C in Paris.",
          type: "AIMessageChunk",
          tool_calls: [],
          invalid_tool_calls: [],
        },
      },
    ],
  ],
});

const AI_WITH_ADDITIONAL_KWARGS_TOOL_CALLS = {
  lc: 1,
  type: "constructor",
  id: ["langchain", "schema", "messages", "AIMessage"],
  kwargs: {
    content: "",
    additional_kwargs: {
      tool_calls: [
        {
          id: "call_9",
          type: "function",
          function: { name: "search_flights", arguments: '{"to": "Lisbon"}' },
        },
      ],
    },
    type: "ai",
  },
};

const MESSAGE_TO_DICT = [
  {
    type: "human",
    data: {
      content: "Hi",
      additional_kwargs: {},
      response_metadata: {},
      type: "human",
      name: null,
      id: null,
    },
  },
  {
    type: "ai",
    data: {
      content: "Hello!",
      additional_kwargs: {},
      response_metadata: {},
      type: "ai",
      name: null,
      id: null,
      tool_calls: [],
      invalid_tool_calls: [],
      usage_metadata: null,
    },
  },
  {
    type: "chat",
    data: {
      content: "Be brief",
      additional_kwargs: {},
      response_metadata: {},
      type: "chat",
      name: null,
      id: null,
      role: "critic",
    },
  },
];

const MODEL_DUMP = [
  {
    content: "You are a helpful travel agent.",
    additional_kwargs: {},
    response_metadata: {},
    type: "system",
    name: null,
    id: null,
  },
  {
    content: [{ type: "text", text: "What is the weather in Paris?" }],
    additional_kwargs: {},
    response_metadata: {},
    type: "human",
    name: null,
    id: null,
  },
];

const DUMPD_LLM_RESULT = {
  generations: [
    [
      {
        lc: 1,
        type: "constructor",
        id: ["langchain", "schema", "output", "ChatGeneration"],
        kwargs: {
          text: "Lisbon is lovely.",
          type: "ChatGeneration",
          message: {
            lc: 1,
            type: "constructor",
            id: ["langchain", "schema", "messages", "AIMessage"],
            kwargs: {
              content: "Lisbon is lovely.",
              type: "ai",
              tool_calls: [],
              invalid_tool_calls: [],
            },
          },
        },
      },
    ],
  ],
  llm_output: { model_name: "gpt-5-mini" },
};

const MODEL_DUMP_LLM_RESULT = {
  generations: [
    [
      {
        text: "It is sunny and 22C in Paris.",
        generation_info: null,
        type: "ChatGeneration",
        message: {
          content: "It is sunny and 22C in Paris.",
          additional_kwargs: {},
          response_metadata: {},
          type: "ai",
          name: null,
          id: null,
        },
      },
    ],
  ],
  llm_output: { model_name: "gpt-5-mini" },
  run: null,
  type: "LLMResult",
};

describe("coerceToChatMessages with LangChain serialised messages", () => {
  describe("given a batch of dumpd constructor messages", () => {
    /** @scenario "A batch of dumpd constructor messages reads as a conversation" */
    it("reads them as a conversation in order with their content", () => {
      const messages = coerceToChatMessages(DUMPD_BATCH);

      expect(messages?.map((m) => m.role)).toEqual([
        "system",
        "user",
        "assistant",
        "tool",
        "assistant",
      ]);
      expect(messages?.[0]?.content).toBe("You are a helpful travel agent.");
      expect(messages?.[1]?.content).toEqual([
        { type: "text", text: "What is the weather in Paris?" },
      ]);
      expect(messages?.[4]?.content).toBe("It is sunny and 22C in Paris.");
    });

    it("finds the system prompt for transcript text extraction", () => {
      expect(extractSystemText(DUMPD_BATCH)).toBe("You are a helpful travel agent.");
    });
  });

  describe("given an AI message with LangChain tool calls", () => {
    /** @scenario "An AI message's tool calls read as OpenAI style tool calls" */
    it("reads them as function tool calls and keeps the tool answer's call id", () => {
      const messages = coerceToChatMessages(DUMPD_BATCH);

      expect(messages?.[2]?.tool_calls).toEqual([
        {
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"Paris"}' },
        },
      ]);
      expect(messages?.[3]).toMatchObject({
        role: "tool",
        tool_call_id: "call_1",
        name: "get_weather",
        content: "Sunny, 22C",
      });
    });
  });

  describe("given an AI message whose tool calls are only in additional_kwargs", () => {
    /** @scenario "Tool calls only in additional_kwargs still read as tool calls" */
    it("reads those tool calls", () => {
      const messages = coerceToChatMessages({ messages: [AI_WITH_ADDITIONAL_KWARGS_TOOL_CALLS] });

      expect(messages).toEqual([
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_9",
              type: "function",
              function: { name: "search_flights", arguments: '{"to": "Lisbon"}' },
            },
          ],
        },
      ]);
    });
  });

  describe("given message_to_dict and model_dump serialisations", () => {
    /** @scenario "model_dump and message_to_dict messages read as chat messages" */
    it("reads message_to_dict messages with their roles", () => {
      expect(coerceToChatMessages({ messages: MESSAGE_TO_DICT })).toEqual([
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "critic", content: "Be brief" },
      ]);
    });

    /** @scenario "model_dump and message_to_dict messages read as chat messages" */
    it("reads model_dump messages with their roles", () => {
      expect(coerceToChatMessages({ messages: MODEL_DUMP })?.map((m) => m.role)).toEqual([
        "system",
        "user",
      ]);
    });
  });

  describe("given an LLM result", () => {
    /** @scenario "An LLM result's generations read as the assistant reply" */
    it("reads a dumpd generation as the assistant reply", () => {
      expect(coerceToChatMessages(DUMPD_LLM_RESULT)).toEqual([
        { role: "assistant", content: "Lisbon is lovely." },
      ]);
    });

    /** @scenario "An LLM result's generations read as the assistant reply" */
    it("reads a model_dump generation as the assistant reply", () => {
      expect(coerceToChatMessages(MODEL_DUMP_LLM_RESULT)).toEqual([
        { role: "assistant", content: "It is sunny and 22C in Paris." },
      ]);
    });
  });

  describe("given a chat_messages typed value of dumpd messages", () => {
    /** @scenario "A typed chat_messages envelope holding LangChain messages reads as chat" */
    it("reads every item as a chat message", () => {
      const messages = coerceToChatMessages({
        type: "chat_messages",
        value: JSON.parse(DUMPD_BATCH).messages[0],
      });

      expect(messages?.map((m) => m.role)).toEqual([
        "system",
        "user",
        "assistant",
        "tool",
        "assistant",
      ]);
    });
  });

  describe("given a chat_messages typed value with an item of no valid role or content", () => {
    /** @scenario "A typed chat_messages envelope holding LangChain messages reads as chat" */
    it("drops that item and keeps the rest", () => {
      const messages = coerceToChatMessages({
        type: "chat_messages",
        value: [{ content: 5 }, { role: 7 }, { role: "user", content: "hello" }],
      });

      expect(messages).toEqual([{ role: "user", content: "hello" }]);
    });
  });

  describe("given a dumpd object that is not a message", () => {
    /** @scenario "A dumpd object that is not a message is not read as chat" */
    it("does not read a prompt template as chat", () => {
      const template = {
        lc: 1,
        type: "constructor",
        id: ["langchain", "prompts", "chat", "ChatPromptTemplate"],
        kwargs: { input_variables: ["q"], messages: [] },
      };

      expect(coerceToChatMessages(template)).toBeNull();
    });

    /** @scenario "A dumpd object that is not a message is not read as chat" */
    it("does not read a document or a list holding one as chat", () => {
      const document = {
        lc: 1,
        type: "constructor",
        id: ["langchain", "schema", "document", "Document"],
        kwargs: { page_content: "hello", type: "Document" },
      };

      expect(coerceToChatMessages(document)).toBeNull();
      expect(coerceToChatMessages({ messages: [document] })).toBeNull();
    });
  });
});

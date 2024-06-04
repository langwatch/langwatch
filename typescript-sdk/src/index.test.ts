import { AzureOpenAI, OpenAI } from "openai";
import { LangWatch, convertFromVercelAIMessages } from "./index";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type SpyInstanceFn,
} from "vitest";
import { openai } from "@ai-sdk/openai";
import { generateText, type CoreMessage } from "ai";
import "dotenv/config";

describe("LangWatch tracer", () => {
  let mockFetch: SpyInstanceFn;

  beforeEach(() => {
    const originalFetch = global.fetch;
    // Mocking fetch to test the right data was sent to the server
    mockFetch = vi.fn((url, ...args) => {
      if (url.includes("localhost.test")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ message: "Trace sent" }),
        });
      }
      return originalFetch(url, ...args);
    });
    // @ts-ignore
    global.fetch = mockFetch;
  });

  it("captures traces correctly", async () => {
    const langwatch = new LangWatch({
      apiKey: "test",
      endpoint: "http://localhost.test",
    });
    const trace = langwatch.getTrace();
    trace.update({
      metadata: { threadId: "123", userId: "123", labels: ["foo"] },
    });
    trace.update({ metadata: { userId: "456", labels: ["bar"] } });

    const span = trace.startSpan({
      name: "weather_function",
      input: {
        type: "json",
        value: {
          city: "Tokyo",
        },
      },
    });
    span.end({
      outputs: [
        {
          type: "json",
          value: {
            weather: "sunny",
          },
        },
      ],
    });

    expect(trace.metadata).toEqual({
      threadId: "123",
      userId: "456",
      labels: ["foo", "bar"],
    });
    expect(span.timestamps.startedAt).toBeDefined();
    expect(span.timestamps.finishedAt).toBeDefined();

    const ragSpan = trace.startRAGSpan({
      name: "my-vectordb-retrieval",
      input: { type: "text", value: "search query" },
    });
    ragSpan.end({
      contexts: [
        {
          documentId: "doc1",
          content: "document chunk 1",
        },
        {
          documentId: "doc2",
          content: "document chunk 2",
        },
      ],
    });

    const llmSpan = ragSpan.startLLMSpan({
      name: "llm",
      model: "gpt-3.5-turbo",
      input: {
        type: "chat_messages",
        value: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "What is the weather in Tokyo?" },
        ],
      },
    });
    llmSpan.end({
      outputs: [
        {
          type: "chat_messages",
          value: [
            {
              role: "assistant",
              content: "It's cloudy in Tokyo.",
            },
          ],
        },
      ],
    });

    ragSpan.end();

    await trace.sendSpans();

    expect(mockFetch).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost.test/api/collector",
      expect.objectContaining({
        method: "POST",
        headers: {
          "X-Auth-Token": "test",
          "Content-Type": "application/json",
        },
        body: expect.any(String),
      })
    );

    const firstCall: any = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(firstCall[1].body);
    expect(requestBody.trace_id).toBeDefined();
    expect(requestBody.metadata).toEqual({
      thread_id: "123",
      user_id: "456",
      labels: ["foo", "bar"],
    });
    expect(requestBody.spans.length).toBe(3);
  });

  it("captures exceptions", async () => {
    const langwatch = new LangWatch({
      apiKey: "test",
      endpoint: "http://localhost.test",
    });
    const trace = langwatch.getTrace();
    trace.update({
      metadata: { threadId: "123", userId: "123", labels: ["foo"] },
    });
    trace.update({ metadata: { userId: "456", labels: ["bar"] } });

    const span = trace.startSpan({
      name: "weather_function",
      input: {
        type: "json",
        value: {
          city: "Tokyo",
        },
      },
    });

    try {
      throw new Error("unexpected error");
    } catch (error) {
      span.end({
        error: error,
      });
    }

    await trace.sendSpans();

    expect(mockFetch).toHaveBeenCalled();
    const firstCall: any = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(firstCall[1].body);
    expect(requestBody.spans[0].error).toEqual({
      has_error: true,
      message: "unexpected error",
      stacktrace: expect.any(Array),
    });
  });

  it.skip("captures openai llm call", async () => {
    const langwatch = new LangWatch({
      apiKey: "test",
      endpoint: "http://localhost.test",
    });
    const trace = langwatch.getTrace();

    // Model to be used and messages that will be sent to the LLM
    const model = "gpt-4o";
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "user",
        content: "Write a tweet-size vegetarian lasagna recipe for 4 people.",
      },
    ];

    // Capture the llm call with a span
    const span = trace.startLLMSpan({
      name: "llm",
      model: model,
      input: {
        type: "chat_messages",
        value: messages,
      },
    });

    // Continue with the LLM call normally
    const openai = new OpenAI();
    const chatCompletion = await openai.chat.completions.create({
      messages: messages,
      model: model,
    });

    span.end({
      outputs: chatCompletion.choices.map((choice) => ({
        type: "chat_messages",
        value: [choice.message],
      })),
    });

    await trace.sendSpans();

    expect(mockFetch).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost.test/api/collector",
      expect.objectContaining({
        method: "POST",
        headers: {
          "X-Auth-Token": "test",
          "Content-Type": "application/json",
        },
        body: expect.any(String),
      })
    );
  });

  it.skip("captures azure openai llm call", async () => {
    const langwatch = new LangWatch({
      apiKey: "test",
      endpoint: "http://localhost.test",
    });
    const trace = langwatch.getTrace();

    // Model to be used and messages that will be sent to the LLM
    const model = "gpt-4-turbo-2024-04-09";
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "user",
        content: "Write a tweet-size vegetarian lasagna recipe for 4 people.",
      },
    ];

    // Capture the llm call with a span
    const span = trace.startLLMSpan({
      name: "llm",
      model: model,
      input: {
        type: "chat_messages",
        value: messages,
      },
    });

    // Continue with the LLM call normally
    const openai = new AzureOpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      apiVersion: "2024-02-01",
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    });
    const chatCompletion = await openai.chat.completions.create({
      messages: messages,
      model: model,
    });

    span.end({
      outputs: chatCompletion.choices.map((choice) => ({
        type: "chat_messages",
        value: [choice.message],
      })),
    });

    await trace.sendSpans();

    expect(mockFetch).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost.test/api/collector",
      expect.objectContaining({
        method: "POST",
        headers: {
          "X-Auth-Token": "test",
          "Content-Type": "application/json",
        },
        body: expect.any(String),
      })
    );
  });

  it.skip("captures vercel ai sdk call", async () => {
    const langwatch = new LangWatch({
      apiKey: "test",
      endpoint: "http://localhost.test",
    });
    const trace = langwatch.getTrace();

    // Model to be used and messages that will be sent to the LLM
    const model = openai("gpt-4o");
    const messages: CoreMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "user",
        content: "Write a tweet-size vegetarian lasagna recipe for 4 people.",
      },
    ];

    const span = trace.startLLMSpan({
      name: "llm",
      model: model.modelId,
      input: {
        type: "chat_messages",
        value: convertFromVercelAIMessages(messages),
      },
    });

    const response = await generateText({
      model: model,
      messages: messages,
    });

    span.end({
      outputs: [
        {
          type: "chat_messages",
          value: convertFromVercelAIMessages(response.responseMessages),
        },
      ],
    });

    await trace.sendSpans();

    expect(mockFetch).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost.test/api/collector",
      expect.objectContaining({
        method: "POST",
        headers: {
          "X-Auth-Token": "test",
          "Content-Type": "application/json",
        },
        body: expect.any(String),
      })
    );
  });
});

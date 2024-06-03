import { LangWatch, convertFromVercelAIMessages } from "./index";
import { describe, it, expect, vi } from "vitest";

describe("LangWatch tracer", () => {
  it("captures traces correctly", async () => {
    const langwatch = new LangWatch({
      apiKey: "test",
      endpoint: "http://localhost.test",
    });
    const trace = langwatch.getTrace();
    trace.update({ metadata: { threadId: "123", userId: "123" } });
    trace.update({ metadata: { userId: "456" } });

    const span = trace.startSpan({ name: "test" });
    span.end();

    expect(trace.metadata).toEqual({ threadId: "123", userId: "456" });
    expect(span.timestamps.startedAt).toBeDefined();
    expect(span.timestamps.finishedAt).toBeDefined();

    const ragSpan = trace.startRAGSpan({ name: "retrieve" });
    ragSpan.update({
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
        value: convertFromVercelAIMessages([
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "What is the weather in Tokyo?" },
        ]),
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

    // Mocking fetch to test the right data was sent to the server
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: "Trace sent" }),
      })
    );
    // @ts-ignore
    global.fetch = mockFetch;

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
    expect(requestBody.metadata).toEqual({ thread_id: "123", user_id: "456" });
    expect(requestBody.spans.length).toBe(3);
  });
});

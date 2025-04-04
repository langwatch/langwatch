import { describe, it, expect } from "vitest";
import { parsePythonInsideJson } from "./parsePythonInsideJson";

describe("parsePythonInsideJson", () => {
  it("should return the same object if no python code is found", () => {
    const obj = { a: 1, b: 2 };
    expect(parsePythonInsideJson(obj)).toEqual(obj);
  });

  it("should return the parsed python code if it is found", () => {
    const obj = { contexts: ["Document(text='Hello, world!', weight=1020.5)"] };
    expect(parsePythonInsideJson(obj)).toEqual({
      contexts: [
        {
          Document: {
            text: "Hello, world!",
            weight: 1020.5,
          },
        },
      ],
    });
  });

  it("should parse a more complex object", () => {
    const obj = {
      output: `AgentFinish(return_values={'output': '\`\`\`python\\nPlease provide the final answer based on your reasoning above...\\"})\\n\\n        start_time = Time(foo=bar)\`\`\`'})`,
    };
    expect(parsePythonInsideJson(obj)).toEqual({
      output: {
        AgentFinish: {
          return_values: {
            output:
              '```python\\nPlease provide the final answer based on your reasoning above...\\"})\\n\\n        start_time = Time(foo=bar)```',
          },
        },
      },
    });
  });

  it("should parse nested reprs", () => {
    const obj = {
      output: `ChatPromptValue(messages=[SystemMessage(content='You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.'), HumanMessage(content='hello')])`,
    };
    expect(parsePythonInsideJson(obj)).toEqual({
      output: {
        ChatPromptValue: {
          messages: [
            {
              SystemMessage: {
                content:
                  "You are a helpful assistant that only reply in short tweet-like responses, using lots of emojis.",
              },
            },
            { HumanMessage: { content: "hello" } },
          ],
        },
      },
    });
  });

  it("should parse unquoted uuids, and mix of = and : too", () => {
    const obj = {
      a: "Document(id=6c90b78ad94e4e634e2a067b5fe2d26d4ce95405ec222cbaefaeb09ab4dce81e, content: 'My name is Jean and I live in Paris.', score: 1.2934543208277889)",
    };
    expect(parsePythonInsideJson(obj)).toEqual({
      a: {
        Document: {
          id: "6c90b78ad94e4e634e2a067b5fe2d26d4ce95405ec222cbaefaeb09ab4dce81e",
          content: "My name is Jean and I live in Paris.",
          score: 1.2934543208277889,
        },
      },
    });
  });

  it("should parse unnamed properties", () => {
    const obj = {
      a: `WeaviateQueryError('Query call with protocol GRPC search failed with message <AioRpcError of RPC that terminated with:\\n\\tstatus = StatusCode.UNKNOWN\\n\\tdetails = "remote client vectorize: Cohere API Key: no api key found neither in request header: X-Cohere-Api-Key nor in environment variable under COHERE_APIKEY"\\n\\tdebug_error_string = "UNKNOWN:Error received from peer  {grpc_message:"remote client vectorize: Cohere API Key: no api key found neither in request header: X-Cohere-Api-Key nor in environment variable under COHERE_APIKEY", grpc_status:2, created_time:"2024-12-23T14:24:08.438868+01:00"}"\\n>.')`,
    };
    expect(parsePythonInsideJson(obj)).toEqual({
      a: {
        WeaviateQueryError:
          'Query call with protocol GRPC search failed with message <AioRpcError of RPC that terminated with:\\n\\tstatus = StatusCode.UNKNOWN\\n\\tdetails = "remote client vectorize: Cohere API Key: no api key found neither in request header: X-Cohere-Api-Key nor in environment variable under COHERE_APIKEY"\\n\\tdebug_error_string = "UNKNOWN:Error received from peer  {grpc_message:"remote client vectorize: Cohere API Key: no api key found neither in request header: X-Cohere-Api-Key nor in environment variable under COHERE_APIKEY", grpc_status:2, created_time:"2024-12-23T14:24:08.438868+01:00"}"\\n>.',
      },
    });
  });
});

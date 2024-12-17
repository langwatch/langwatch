import { describe, it, expect } from "vitest";
import { parsePythonInsideJson } from "./parsePythonInsideJson";

describe("parsePythonInsideJson", () => {
  it("should return the same object if no python code is found", () => {
    const obj = { a: 1, b: 2 };
    expect(parsePythonInsideJson(obj)).toEqual(obj);
  });

  it("should return the parsed python code if it is found", () => {
    const obj = { contexts: ["Document(text='Hello, world!', weight=0.5)"] };
    expect(parsePythonInsideJson(obj)).toEqual({
      contexts: [
        {
          Document: {
            text: "Hello, world!",
            weight: 0.5,
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
});

import { describe, expect, it } from "vitest";

import { requestMessages } from "../request-messages.ts";

describe("requestMessages", () => {
  it("reads OpenAI, Anthropic and Gemini bodies as turns", () => {
    expect(
      requestMessages({
        request: {
          messages: [
            { role: "system", content: "Be brief." },
            { role: "user", content: [{ type: "text", text: "Hi" }, { type: "image_url" }] },
          ],
        },
      }),
    ).toEqual([
      { role: "system", text: "Be brief." },
      { role: "user", text: "Hi" },
    ]);
    expect(
      requestMessages({
        request: { system: "Be kind.", messages: [{ role: "user", content: "Yo" }] },
      }),
    ).toEqual([
      { role: "system", text: "Be kind." },
      { role: "user", text: "Yo" },
    ]);
    expect(
      requestMessages({
        request: {
          systemInstruction: { parts: [{ text: "Rules" }] },
          contents: [{ role: "user", parts: [{ text: "Ask" }] }],
        },
      }),
    ).toEqual([
      { role: "system", text: "Rules" },
      { role: "user", text: "Ask" },
    ]);
  });

  it("reads an unknown body as no turns", () => {
    expect(requestMessages({ request: "nope" })).toEqual([]);
    expect(requestMessages({ request: undefined })).toEqual([]);
  });
});

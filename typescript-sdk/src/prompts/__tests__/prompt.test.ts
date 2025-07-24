import { describe, it, expect, beforeAll, afterAll } from "vitest";
import nock from "nock";
import { PromptService } from "../prompt-service";
import { Prompt, PromptCompilationError } from "../prompt";
import { createClient } from "../../api-client/client";
// In your test setup file (e.g., jest.setup.js)
import fetch, { Headers, Request, Response } from "node-fetch";

const TEST_PROMPT_ID = "prompt_XhPJ4fvAYC-xdEx1tF2gt";

// @ts-ignore
global.fetch = fetch;
// @ts-ignore
global.Headers = Headers;
// @ts-ignore
global.Request = Request;
// @ts-ignore
global.Response = Response;

describe("Prompt", () => {
  let promptService: PromptService;

  beforeAll(async () => {
    // Configure nock to intercept fetch requests
    if (process.env.NOCK_RECORD) {
      // Record mode - intercept and record real requests
      nock.back.setMode("record");
      nock.back.fixtures = __dirname + "/fixtures/";

      // Enable fetch interception for recording
      // nock.activate();
    } else {
      // Playback mode - use recorded fixtures
      nock.back.setMode("lockdown");
      nock.back.fixtures = __dirname + "/fixtures/";
    }

    const client = createClient({
      apiKey: process.env.NOCK_RECORD
        ? process.env.LANGWATCH_API_KEY!
        : "REDACTED_API_KEY",
      endpoint: process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai",
    });

    promptService = new PromptService({ deps: { client } });
  });

  afterAll(() => {
    if (process.env.NOCK_RECORD) {
      nock.restore();
    }
    nock.cleanAll();
  });

  it("should fetch and compile a prompt", async () => {
    const { nockDone } = await nock.back("prompt-fetch.json");

    const prompt = await promptService.get(TEST_PROMPT_ID);

    expect(prompt.id).toBeDefined();
    expect(prompt.name).toBeDefined();

    // Test template compilation
    const compiled = prompt.compile({
      user_name: "Alice",
      topic: "weather",
    });

    expect(compiled.prompt).toContain("Alice");
    expect(JSON.stringify(compiled.messages)).toContain("weather");

    nockDone();
  });

  it("should handle missing template variables gracefully", async () => {
    const { nockDone } = await nock.back("prompt-fetch-graceful.json");

    const prompt = await promptService.get(TEST_PROMPT_ID);

    // Lenient compilation should not throw
    const compiled = prompt.compile({});
    expect(compiled).toBeInstanceOf(Prompt);

    nockDone();
  });

  it("should throw on strict compilation with missing variables", async () => {
    const { nockDone } = await nock.back("prompt-fetch-strict.json");

    const prompt = await promptService.get(TEST_PROMPT_ID);

    expect(() => {
      prompt.compileStrict({});
    }).toThrow(PromptCompilationError);

    nockDone();
  });

  it.todo("should create a prompt");
  it.todo("should update a prompt");
  it.todo("should delete a prompt");
  it.todo("should create a prompt version");
  it.todo("should get a prompt version");
  it.todo("should list prompt versions");
  it.todo("should delete a prompt version");
});

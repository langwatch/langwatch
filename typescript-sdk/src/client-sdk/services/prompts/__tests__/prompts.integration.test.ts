/**
 * Integration tests for PromptsFacade with MSW.
 * Tests CRUD operations and get prompt behavior with mocked API.
 */
import {
  describe,
  expect,
  it,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from "vitest";
import { setupServer } from "msw/node";
import { createOpenApiHttp } from "openapi-msw";
import * as fs from "fs";
import * as path from "path";
import type { paths } from "@/internal/generated/openapi/api-client";
import { promptResponseFactory } from "../../../../../__tests__/factories/prompt.factory";
import { CliRunner } from "../../../../../__tests__/e2e/cli/helpers/cli-runner";
import { LangWatch } from "@/client-sdk";

const http = createOpenApiHttp<paths>({
  baseUrl: process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560",
});

const handlers = [
  http.get("/api/prompts/{id}", ({ params, request, response }) => {
    const url = new URL(request.url);
    const versionParam = url.searchParams.get("version");
    const prompt = promptResponseFactory.build({
      id: params.id,
      ...(versionParam && { version: parseInt(versionParam, 10) }),
    });
    return response(200).json(prompt);
  }),
  http.post("/api/prompts", async ({ request, response }) => {
    const body = await request.json();
    const prompt = promptResponseFactory.build({
      handle: body?.handle,
      scope: body?.scope,
    });
    return response(200).json({
      ...prompt,
      organizationId: "123",
      projectId: "123",
    });
  }),
  http.put("/api/prompts/{id}", async ({ params, request, response }) => {
    const body = await request.json();
    const prompt = promptResponseFactory.build({
      ...body,
      id: params.id,
      handle: body?.handle,
    });
    return response(200).json(prompt);
  }),
  http.delete("/api/prompts/{id}", async ({ response }) => {
    return response(200).json({ success: true });
  }),
];

const server = setupServer();

const TMP_BASE_DIR = path.join(__dirname, "tmp");

const setupCliRunner = () => {
  fs.mkdirSync(TMP_BASE_DIR, { recursive: true });
  const testDir = fs.mkdtempSync(path.join(TMP_BASE_DIR, "test-dir-"));
  const originalCwd = process.cwd();
  process.chdir(testDir);
  const cli = new CliRunner({ cwd: testDir });
  return { cli, testDir, originalCwd };
};

const teardownCliRunner = (params: {
  testDir: string;
  originalCwd: string;
}) => {
  const { testDir, originalCwd } = params;
  process.chdir(originalCwd);
  fs.rmSync(testDir, { recursive: true, force: true });
};

const createLocalPromptFile = (params: {
  handle: string;
  cli: CliRunner;
  testDir: string;
}) => {
  const { handle, cli, testDir } = params;
  const initResult = cli.run(`prompt init`);
  expect(initResult.success).toBe(true);
  const createResult = cli.run(`prompt create ${handle}`);
  expect(createResult.success).toBe(true);
  const promptFilePath = path.join(testDir, "prompts", `${handle}.prompt.yaml`);
  const addResult = cli.run(`prompt add ${handle} ${promptFilePath}`);
  expect(addResult.success).toBe(true);
  return { promptFilePath };
};

describe("Prompts Integration", () => {
  let langwatch: LangWatch;

  beforeAll(() => {
    server.listen({ onUnhandledRequest: "bypass" });
    langwatch = new LangWatch({
      apiKey: process.env.LANGWATCH_API_KEY ?? "test-api-key",
      endpoint: process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560",
    });
  });

  beforeEach(() => {
    server.use(...handlers);
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  describe("CRUD operations", () => {
    it("creates prompt", async () => {
      const prompt = await langwatch.prompts.create({ handle: "test" });
      expect(prompt?.handle).toBe("test");
    });

    it("updates prompt", async () => {
      const systemPrompt = "test system prompt";
      const prompt = await langwatch.prompts.update("handle", {
        prompt: systemPrompt,
        commitMessage: "test update",
      });
      expect(prompt.prompt).toBe(systemPrompt);
    });

    it("deletes prompt", async () => {
      const result = await langwatch.prompts.delete("handle");
      expect(result).toEqual({ success: true });
    });
  });

  describe("get prompt", () => {
    let cli: CliRunner;
    let testDir: string;
    let originalCwd: string;

    beforeAll(() => {
      const setupResult = setupCliRunner();
      cli = setupResult.cli;
      testDir = setupResult.testDir;
      originalCwd = setupResult.originalCwd;
    });

    afterAll(() => {
      teardownCliRunner({ testDir, originalCwd });
    });

    describe("when no local prompt file is present", () => {
      it("returns server prompt", async () => {
        const prompt = await langwatch.prompts.get("123");
        expect(prompt?.id).toBe("123");
      });
    });

    describe("when local prompt file is present", () => {
      const handle = "my-test-prompt";

      beforeAll(() => {
        createLocalPromptFile({ handle, cli, testDir });
      });

      it("returns local prompt", async () => {
        const prompt = await langwatch.prompts.get(handle);
        expect(prompt?.handle).toBe(handle);
      });
    });
  });
});

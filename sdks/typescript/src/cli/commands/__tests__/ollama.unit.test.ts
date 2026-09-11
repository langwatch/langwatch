/**
 * `langwatch ollama` as a launcher: what it starts, what it refuses, where it
 * decides the captured calls go, and what it does when there is nowhere to
 * send them. The proxy's own behaviour is covered against real sockets in
 * ollama-proxy.integration.test.ts; here the proxy is a stub, because the
 * questions are about the command.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

const loadConfigMock = vi.hoisted(() => vi.fn());
const isLoggedInMock = vi.hoisted(() => vi.fn());
vi.mock("../../utils/governance/config", () => ({
  loadConfig: loadConfigMock,
  isLoggedIn: isLoggedInMock,
}));

const resolveIngestionCredentialMock = vi.hoisted(() => vi.fn());
vi.mock("../../utils/governance/telemetry-refresh", () => ({
  resolveIngestionCredential: resolveIngestionCredentialMock,
  otlpEndpointFor: (base: string) => `${base.replace(/\/+$/, "")}/api/otel`,
}));

const startProxyMock = vi.hoisted(() => vi.fn());
vi.mock("../../utils/governance/ollama-proxy", () => ({
  DEFAULT_OLLAMA_ORIGIN: "http://127.0.0.1:11434",
  resolveUpstreamOrigin: () => "http://127.0.0.1:11434",
  startOllamaCaptureProxy: startProxyMock,
}));

const createEmitterMock = vi.hoisted(() => vi.fn());
const createDiscardingEmitterMock = vi.hoisted(() => vi.fn());
vi.mock("../../utils/governance/ollama-emitter", () => ({
  createOllamaSpanEmitter: createEmitterMock,
  createDiscardingSpanEmitter: createDiscardingEmitterMock,
}));

import { ollamaCommand, resolveOllamaCaptureScope } from "../ollama";

class Exited extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

/** A child process that ends the way the test says, on the next tick. */
function fakeChild({ code = 0, error }: { code?: number; error?: NodeJS.ErrnoException } = {}) {
  const child = new EventEmitter();
  setTimeout(() => {
    if (error) child.emit("error", error);
    child.emit("close", error ? null : code);
  }, 0);
  return child;
}

function stubEmitter(sent = 0) {
  return { add: vi.fn(), flush: vi.fn(), close: vi.fn(), sent: () => sent };
}

describe("the langwatch ollama launcher", () => {
  let stderr: string;
  let stdout: string;

  beforeEach(() => {
    stderr = "";
    stdout = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    });
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    });
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Exited(code ?? 0);
    }) as never);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    loadConfigMock.mockReturnValue({ control_plane_url: "https://app.langwatch.ai" });
    isLoggedInMock.mockReturnValue(true);
    resolveIngestionCredentialMock.mockResolvedValue({
      token: "ik-lw-personal",
      endpoint: "https://app.langwatch.ai/api/otel",
      minted: false,
      scope: "personal",
    });
    createEmitterMock.mockReturnValue(stubEmitter());
    createDiscardingEmitterMock.mockReturnValue(stubEmitter());
    startProxyMock.mockResolvedValue({ url: "http://127.0.0.1:54321", close: vi.fn() });
    spawnMock.mockReturnValue(fakeChild());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("when a command is wrapped", () => {
    /** @scenario "Arguments are forwarded in the order they were written" */
    it("starts ollama with the arguments as written, pointed at the proxy", async () => {
      await expect(ollamaCommand(["run", "llama3", "--verbose"])).rejects.toBeInstanceOf(Exited);

      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [binary, args, options] = spawnMock.mock.calls[0]!;
      expect(binary).toBe("ollama");
      expect(args).toEqual(["run", "llama3", "--verbose"]);
      expect((options as { env: Record<string, string> }).env.OLLAMA_HOST).toBe(
        "http://127.0.0.1:54321",
      );
    });

    /** @scenario "The exit code is the wrapped command's own" */
    it("exits with the code ollama exited with", async () => {
      spawnMock.mockReturnValue(fakeChild({ code: 3 }));

      await expect(ollamaCommand(["run", "llama3"])).rejects.toMatchObject({ code: 3 });
    });

    it("closes the proxy and the emitter before it exits", async () => {
      const close = vi.fn();
      const emitter = stubEmitter(2);
      startProxyMock.mockResolvedValue({ url: "http://127.0.0.1:54321", close });
      createEmitterMock.mockReturnValue(emitter);

      await expect(ollamaCommand(["run", "llama3"])).rejects.toBeInstanceOf(Exited);

      expect(close).toHaveBeenCalled();
      expect(emitter.close).toHaveBeenCalled();
      expect(stdout).toContain("reported 2 ollama calls");
    });

    it("says nothing about reporting when the session made no model calls", async () => {
      await expect(ollamaCommand(["list"])).rejects.toBeInstanceOf(Exited);

      expect(stdout).not.toContain("reported");
    });
  });

  describe("when ollama is not installed", () => {
    /** @scenario "A missing ollama binary is reported as a missing install" */
    it("says so and where to get it", async () => {
      const error: NodeJS.ErrnoException = new Error("spawn ollama ENOENT");
      error.code = "ENOENT";
      spawnMock.mockReturnValue(fakeChild({ error }));

      await expect(ollamaCommand(["run", "llama3"])).rejects.toMatchObject({ code: 127 });

      expect(stderr).toContain("ollama is not installed");
      expect(stderr).toContain("https://ollama.com/download");
    });
  });

  describe("when the server itself is being started", () => {
    /** @scenario "Starting the server through the wrapper is refused" */
    it("refuses before anything is started and says what to do instead", async () => {
      await expect(ollamaCommand(["serve"])).rejects.toMatchObject({ code: 1 });

      expect(spawnMock).not.toHaveBeenCalled();
      expect(startProxyMock).not.toHaveBeenCalled();
      expect(stderr).toContain("OLLAMA_HOST");
      expect(stderr).toContain("Run `ollama serve` directly");
    });

    it("still wraps a command whose arguments merely mention serving", async () => {
      await expect(ollamaCommand(["run", "llama3", "serve me a haiku"])).rejects.toBeInstanceOf(
        Exited,
      );

      expect(spawnMock).toHaveBeenCalled();
    });
  });

  describe("when the configured server does not answer", () => {
    /** @scenario "An unreachable server is named before the command starts" */
    it("names the address and runs the command anyway", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      );

      await expect(ollamaCommand(["run", "llama3"])).rejects.toBeInstanceOf(Exited);

      expect(stderr).toContain("no ollama server answered at http://127.0.0.1:11434");
      expect(spawnMock).toHaveBeenCalled();
    });
  });

  describe("when the device has no LangWatch scope", () => {
    /** @scenario "Without a scope the command says what to do and runs anyway" */
    it("says how to get one and runs ollama uncaptured", async () => {
      isLoggedInMock.mockReturnValue(false);
      delete process.env.LANGWATCH_INGEST_KEY;

      await expect(ollamaCommand(["run", "llama3"])).rejects.toBeInstanceOf(Exited);

      expect(stderr).toContain("langwatch login --device");
      expect(stderr).toContain("LANGWATCH_INGEST_KEY");
      expect(createEmitterMock).not.toHaveBeenCalled();
      expect(createDiscardingEmitterMock).toHaveBeenCalled();
      expect(spawnMock).toHaveBeenCalled();
    });
  });
});

describe("deciding where the captured calls go", () => {
  beforeEach(() => {
    resolveIngestionCredentialMock.mockReset();
    isLoggedInMock.mockReset();
  });

  /** @scenario "A pinned project key sends the session to that project" */
  it("uses the pinned project key and its instance", async () => {
    resolveIngestionCredentialMock.mockResolvedValue({
      token: "ik-lw-project",
      endpoint: "https://self-hosted.example.com/api/otel",
      minted: false,
      scope: "project",
      projectLabel: "my-project",
    });

    const scope = await resolveOllamaCaptureScope({
      cfg: {
        control_plane_url: "https://app.langwatch.ai",
        gateway_url: "https://gateway.langwatch.ai",
        tool_project_keys: { ollama: { secret: "ik-lw-project" } },
      },
      env: {},
    });

    expect(scope).toEqual({
      tracesEndpoint: "https://self-hosted.example.com/api/otel/v1/traces",
      token: "ik-lw-project",
      label: "project my-project",
    });
  });

  /** @scenario "A pasted ingest key in the environment is used as-is" */
  it("uses a pasted key without asking the platform for one", async () => {
    const scope = await resolveOllamaCaptureScope({
      cfg: {
        control_plane_url: "https://app.langwatch.ai",
        gateway_url: "https://gateway.langwatch.ai",
      },
      env: { LANGWATCH_INGEST_KEY: "ik-lw-pasted" },
    });

    expect(scope?.token).toBe("ik-lw-pasted");
    expect(scope?.tracesEndpoint).toBe("https://app.langwatch.ai/api/otel/v1/traces");
    expect(resolveIngestionCredentialMock).not.toHaveBeenCalled();
  });

  /** @scenario "Otherwise the signed-in personal workspace receives the session" */
  it("falls back to the signed-in personal workspace", async () => {
    isLoggedInMock.mockReturnValue(true);
    resolveIngestionCredentialMock.mockResolvedValue({
      token: "ik-lw-personal",
      endpoint: "https://app.langwatch.ai/api/otel",
      minted: true,
      scope: "personal",
    });

    const scope = await resolveOllamaCaptureScope({
      cfg: {
        control_plane_url: "https://app.langwatch.ai",
        gateway_url: "https://gateway.langwatch.ai",
      },
      env: {},
    });

    expect(scope?.label).toBe("your personal workspace");
    expect(scope?.token).toBe("ik-lw-personal");
  });

  it("has no scope at all when the device is not signed in and nothing is pasted", async () => {
    isLoggedInMock.mockReturnValue(false);

    const scope = await resolveOllamaCaptureScope({
      cfg: {
        control_plane_url: "https://app.langwatch.ai",
        gateway_url: "https://gateway.langwatch.ai",
      },
      env: {},
    });

    expect(scope).toBeNull();
    expect(resolveIngestionCredentialMock).not.toHaveBeenCalled();
  });
});

/**
 * A pi run by someone who holds a virtual key is still read from its file.
 *
 * The sibling file (`pi-virtual-key-routing.unit.test.ts`) asserts the routing
 * decision on its own. This one asserts the consequence, end to end, because
 * the two are not the same claim: the wrapper starts pi's reader with no test
 * on the resolved mode (wrapper.ts:800), so "the reader started" is true even
 * on a gateway run — what a gateway run loses is the endpoint and the token,
 * and with them everything the reader would have posted.
 *
 * So this drives the REAL `runWrapped` with a REAL personal key in the config
 * and the REAL path + mode resolution, and observes both halves at once:
 * the session's turns reach the wire, and the key reaches neither the wire nor
 * the child's environment. A build that let a key divert pi to the gateway
 * fails on both — nothing posted, and the key in pi's env on its way to a
 * vendor that is not us. ADR-132 §7.
 *
 * Spec: specs/coding-agent/pi-session-capture.feature
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENDPOINT = "https://app.langwatch.test/api/otel";
const TOKEN = "ik-lw-ingest-test";
const VK_SECRET = "vk-lw-personal-secret";

/**
 * The fake pi process. `writes` is what "pi" puts on disk while it runs, and
 * it has to land AFTER the wrapper stamps the run's start — a fixture written
 * during setup is correctly ignored as a session this run did not launch, and
 * a test that ignores everything passes while capturing nothing.
 *
 * `envs` records the environment each spawn was handed, which is where the
 * credential assertion is made.
 */
const child = vi.hoisted(() => {
  const state: {
    writes: (() => Promise<void>) | null;
    envs: Record<string, string | undefined>[];
  } = { writes: null, envs: [] };
  const spawnMock = vi.fn(
    (_cmd: string, _args: string[], opts?: { env?: NodeJS.ProcessEnv }) => {
      state.envs.push({ ...(opts?.env ?? {}) });
      return {
        on(event: string, handler: (arg: unknown) => void) {
          if (event !== "close") return this;
          void (async () => {
            await state.writes?.();
            handler(0);
          })();
          return this;
        },
      };
    },
  );
  return { state, spawnMock };
});

vi.mock("node:child_process", () => ({ spawn: child.spawnMock }));

vi.mock("../config", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  // A logged-in user who holds a personal virtual key — the only fact under
  // test. Everything else is the config a first run would have.
  loadConfig: () => ({
    control_plane_url: "https://app.langwatch.test",
    gateway_url: "https://gw.langwatch.test",
    access_token: "tok",
    organization: { id: "o1", slug: "acme" },
    default_personal_vk: { id: "vk1", secret: VK_SECRET },
  }),
  isLoggedIn: () => true,
  saveConfig: () => undefined,
}));

// The credential the ingestion path would mint, stubbed at the network
// boundary. Path and mode resolution above it stay REAL: they are what this
// test is about.
vi.mock("../telemetry-refresh", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveIngestionCredential: async () => ({
    token: TOKEN,
    endpoint: ENDPOINT,
    minted: false,
    scope: "personal" as const,
  }),
}));

vi.mock("../cli-api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCliBootstrap: async () => null,
}));
vi.mock("../cli-location", () => ({ recordCliLocation: () => undefined }));
vi.mock("../claude-plugin", () => ({
  updateLangwatchClaudePlugin: () => ({ ok: true }),
}));
vi.mock("../shell-rc", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  SHELL_FUNCTION_TOOLS: [] as string[],
  maybeOfferIngestionShellRcPersist: async () => undefined,
}));
vi.mock("../../spinner", () => ({
  createSpinner: () => ({ start: () => undefined, stop: () => undefined }),
}));

import { runWrapped } from "../wrapper";

const OWN_ID = "44444444-4444-4444-8444-444444444444";

let dir: string;
let posted: string[];
let exitCalls: number[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pi-vk-capture-"));
  posted = [];
  exitCalls = [];
  child.state.writes = null;
  child.state.envs = [];
  child.spawnMock.mockClear();
  process.env.PI_CODING_AGENT_SESSION_DIR = dir;

  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    _url: unknown,
    init?: { body?: string },
  ) => {
    if (init?.body) posted.push(init.body);
    return { ok: true, status: 200 } as Response;
  }) as unknown as typeof fetch);

  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    exitCalls.push(code);
    throw new Error(`__exit__${code}`);
  }) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("given a user who holds a personal virtual key", () => {
  describe("when they run a pi session through the wrapper", () => {
    /**
     * Both halves in one run, because either alone passes on the bug.
     *
     * "The turns reached the wire" alone passes on a build that also handed
     * pi the key. "The key is not in the env" alone passes on a build that
     * captured nothing at all — which is precisely what a gateway-routed pi
     * run looks like, since that path resolves no ingestion endpoint and the
     * reader has nowhere to post.
     */
    /** @scenario "A virtual key does not switch pi to server-side capture" */
    it("reads the session file and posts its turns, with the key in neither the wire nor pi's environment", async () => {
      child.state.writes = async () => {
        // Stamped when written, which is mid-run: capture keeps only turns at
        // or after the run's start, so a fixed past instant would be discarded
        // as another run's work and nothing would reach the wire.
        const turnAt = new Date().toISOString();
        await writeFile(
          join(dir, "own.jsonl"),
          `${JSON.stringify({
            type: "session",
            id: OWN_ID,
            version: 3,
            createdAt: "2026-09-14T10:00:00.000Z",
          })}\n${JSON.stringify({
            type: "message",
            id: "aaaaaaaa",
            parentId: null,
            timestamp: turnAt,
            message: {
              role: "assistant",
              content: [{ type: "text", text: "hello" }],
              timestamp: Date.parse(turnAt),
              model: "openai/gpt-5-mini",
            },
          })}\n`,
          "utf8",
        );
      };

      await runWrapped("pi", []).catch((err: Error) => {
        if (!err.message.startsWith("__exit__")) throw err;
      });

      expect(exitCalls).toEqual([0]);
      // Capture happened: this session's own id is in a posted body, which
      // only a reader that ran and had somewhere to post could produce.
      expect(posted.length).toBeGreaterThan(0);
      expect(posted.join("\n")).toContain(OWN_ID);
      expect(posted.join("\n")).not.toContain(VK_SECRET);

      // And the key never reached the child. pi would have sent it to the
      // vendor it dials directly, which is not us.
      //
      // Counted rather than asserted on the env itself: the child inherits the
      // whole parent environment, so a failing `expect(env).not.toContain(...)`
      // would print every variable the machine holds into the CI log. The
      // count says the same thing and names nothing.
      expect(child.state.envs.length).toBeGreaterThan(0);
      const leaking = child.state.envs.filter((env) =>
        Object.values(env).includes(VK_SECRET),
      ).length;
      expect(leaking).toBe(0);
    });
  });
});

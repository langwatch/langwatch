/**
 * @vitest-environment node
 *
 * @see specs/scenarios/pre-compiled-child-process.feature
 */
import { EventEmitter } from "events";

import {
  VOICE_NONCE_REGISTER_MESSAGE,
  type ChildProcessJobData,
} from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/child-process-spawn.service.ts", () => ({
  ChildProcessSpawnService: {
    create: () => ({
      resolve: () => ({ command: "node", args: ["/dist/bundle.cjs"] }),
    }),
  },
}));

const stdinWrite = vi.fn();
const stdinEnd = vi.fn();
const childSend = vi.fn();
const spawned: EventEmitter[] = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      pid: 123,
      stdin: { write: stdinWrite, end: stdinEnd, on: vi.fn() },
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
      send: childSend,
    });
    spawned.push(child);
    return child;
  }),
}));

import { type ScenarioExecutionRunner } from "../app/scenario.app.ts";
import { MemoryVoiceNonceRepository } from "../repositories/memory/memory.voice-nonce.repository.ts";
import {
  NodeScenarioChildService,
  type ScenarioChildProcessConfig,
} from "../services/node-scenario-child.service.ts";
import { ScenarioExecutionPoolService } from "../services/scenario-execution-pool.service.ts";
import type { ExecutionJobData } from "../services/scenario-execution-pool.service.ts";
import { VoiceNonceRegistryService } from "../services/voice-nonce-registry.service.ts";

/** A runner that never actually executes — the pool only needs the job
 * marked active so `registerChild` below finds it. */
class NoopRunner implements ScenarioExecutionRunner {
  async execute(): Promise<void> {}
  skipCancelled(): void {}
}

function job(): ExecutionJobData {
  return {
    projectId: "proj-1",
    scenarioId: "scen-1",
    scenarioRunId: "run-1",
    batchRunId: "batch-1",
    setId: "set-1",
    target: { type: "http", referenceId: "agent-1" },
  };
}

const jobData: ChildProcessJobData = {
  context: { projectId: "proj-1", scenarioId: "scen-1", setId: "set-1", batchRunId: "batch-1" },
  scenario: { id: "scen-1", name: "Test", situation: "Ask", criteria: [], labels: [] },
  adapterData: {
    type: "http",
    agentId: "agent-1",
    url: "https://x.test",
    method: "POST",
    headers: [],
    secrets: {},
  },
  nlpServiceUrl: "http://langwatch_nlp:5561",
  target: { type: "http", referenceId: "agent-1" },
  parameters: {},
};

const childConfig: ScenarioChildProcessConfig = {
  packageRoot: "/app",
  sourcePath: "/app/src/adapter.ts",
  sourceRoots: ["/app/src"],
  nodeEnv: "production",
  isSaas: true,
  egress: { blockLocal: true, allowedHosts: [] },
  parentEnvironment: {},
};

function poolWith(jobData: ExecutionJobData): ScenarioExecutionPoolService {
  const pool = ScenarioExecutionPoolService.create({ concurrency: 1 });
  pool.connect(new NoopRunner());
  pool.submit(jobData);
  return pool;
}

describe("NodeScenarioChildService", () => {
  beforeEach(() => {
    stdinWrite.mockClear();
    stdinEnd.mockClear();
    childSend.mockClear();
    spawned.length = 0;
  });

  describe("given a phone run's child asking to register its stream nonce", () => {
    it("registers it against that child, then acks", async () => {
      const nonces = VoiceNonceRegistryService.create({
        nonces: MemoryVoiceNonceRepository.create(),
      });
      const voiceJob: ExecutionJobData = {
        ...job(),
        target: { type: "voice", referenceId: "agent-1" },
      };
      const adapter = NodeScenarioChildService.create({
        config: childConfig,
        pool: poolWith(voiceJob),
        nonces,
      });
      const session = adapter.start({
        jobData: voiceJob,
        environment: { labels: [], telemetry: { endpoint: "https://x.test", apiKey: "key" } },
      });
      void session.execute({
        ...jobData,
        target: { type: "voice", referenceId: "agent-1" },
        adapterData: {
          type: "voice",
          agentId: "agent-1",
          voiceTarget: {
            transport: "phone",
            agentId: "+14155550123",
            credential: {
              kind: "twilio",
              accountSid: "AC1",
              authToken: "twilio-token",
              fromNumber: "+14155550100",
            },
            callDirection: "outbound",
          },
          callerEnv: {},
          maxCallSeconds: 300,
        },
      });

      spawned[0]?.emit("message", {
        type: VOICE_NONCE_REGISTER_MESSAGE,
        requestId: "r1",
        nonce: "n1",
      });

      await vi.waitFor(() =>
        expect(childSend).toHaveBeenCalledWith(
          expect.objectContaining({ requestId: "r1", ok: true }),
        ),
      );
      await expect(nonces.consume("n1")).resolves.toMatchObject({ ok: true });
    });
  });

  describe("given a child process spawned from the pre-compiled bundle", () => {
    /** @scenario "Child process receives job data via stdin" */
    it("writes the job data to the child's stdin as JSON", () => {
      const adapter = NodeScenarioChildService.create({
        config: {
          packageRoot: "/app",
          sourcePath: "/app/src/adapter.ts",
          sourceRoots: ["/app/src"],
          nodeEnv: "production",
          isSaas: true,
          egress: { blockLocal: true, allowedHosts: [] },
          parentEnvironment: {},
        },
        pool: (() => {
          const pool = ScenarioExecutionPoolService.create({ concurrency: 1 });
          pool.connect(new NoopRunner());
          pool.submit(job());
          return pool;
        })(),
        nonces: VoiceNonceRegistryService.create({ nonces: MemoryVoiceNonceRepository.create() }),
      });

      const session = adapter.start({
        jobData: job(),
        environment: { labels: [], telemetry: { endpoint: "https://x.test", apiKey: "key" } },
      });
      void session.execute(jobData);

      expect(stdinWrite).toHaveBeenCalledWith(JSON.stringify(jobData));
      expect(stdinEnd).toHaveBeenCalled();
    });
  });
});

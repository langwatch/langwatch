/**
 * @vitest-environment node
 *
 * SSRF containment for the scenario HTTP agent.
 *
 * This is the one outbound call in scenario execution whose destination the
 * customer authors, and the only one that runs inside the spawned child — a
 * process holding the run's telemetry credentials, on a worker that sits inside
 * the cluster. A URL that reaches the instance metadata service or a
 * neighbouring pod from there reaches it with the platform's network position.
 *
 * The adapter's other tests all `vi.mock("~/utils/ssrfProtection")`, so they
 * establish what the adapter *passes* to the guard but nothing about the guard
 * being reached: swapping `ssrfSafeFetch` for a bare `fetch` keeps every one of
 * them green. These use the REAL guard and assert on its own refusal, which is
 * the part a bypass could not fake — an unguarded `fetch` to these addresses
 * fails with a connection error, not with a policy one.
 *
 * The URLs below are literal IPs and known cloud hostnames, which the validator
 * refuses before resolving anything: no DNS, no sockets, and no dependence on
 * how `BLOCK_LOCAL_HTTP_CALLS` happens to be set where the tests run (cloud
 * metadata and cloud-internal domains are blocked under either setting).
 *
 * @see specs/scenarios/scenario-execution-process-manager.feature
 */

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HttpAgentData } from "../../types";
import { SerializedHttpAgentAdapter } from "../http-agent.adapter";

vi.mock("@langwatch/observability/tracing", () => ({
  injectTraceContextHeaders: vi.fn(
    ({ headers }: { headers: Record<string, string> }) => ({
      headers,
      traceId: undefined,
    }),
  ),
}));

/** The guard's own vocabulary. Only it produces these. */
const REFUSED_BY_POLICY = /is not allowed for security reasons/;

function makeConfig(url: string): HttpAgentData {
  return {
    type: "http",
    agentId: "agent_123",
    url,
    method: "POST",
    headers: [],
    outputPath: "$.response",
  };
}

const INPUT: AgentInput = {
  threadId: "thread_123",
  messages: [{ role: "user", content: "Hello" }],
  newMessages: [{ role: "user", content: "Hello" }],
  requestedRole: AgentRole.AGENT,
  scenarioState: {} as AgentInput["scenarioState"],
  scenarioConfig: {} as AgentInput["scenarioConfig"],
};

/** Swallows output — these tests deliberately provoke errors. */
const QUIET_LOGGER = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => QUIET_LOGGER,
} as unknown as ConstructorParameters<typeof SerializedHttpAgentAdapter>[1];

function callWith({ url, said }: { url: string; said?: string }) {
  const adapter = new SerializedHttpAgentAdapter(makeConfig(url), QUIET_LOGGER);
  if (said === undefined) return adapter.call(INPUT);
  return adapter.call({
    ...INPUT,
    messages: [{ role: "user", content: said }],
    newMessages: [{ role: "user", content: said }],
  });
}

describe("scenario HTTP agent SSRF containment", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("given a scenario target pointed at infrastructure rather than an agent", () => {
    it.each([
      [
        "the instance metadata service",
        "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      ],
      [
        "the GCP metadata hostname",
        "http://metadata.google.internal/computeMetadata/v1/",
      ],
      ["a link-local address", "http://169.254.1.1/"],
    ])("refuses %s as a matter of policy", async ({}, url) => {
      // Asserting the *policy* refusal, not just "it threw": an adapter that
      // had drifted onto a bare fetch would still throw here, with a
      // connection error, and a weaker assertion would call that a pass.
      await expect(callWith({ url })).rejects.toThrow(REFUSED_BY_POLICY);
    });
  });

  describe("given a scenario target using a scheme that is not http", () => {
    it.each([
      ["file:", "file:///etc/passwd"],
      ["ftp:", "ftp://internal.example.com/secrets"],
      ["gopher:", "gopher://127.0.0.1:6379/_FLUSHALL"],
    ])("refuses %s before resolving anything", async ({}, url) => {
      await expect(callWith({ url })).rejects.toThrow(
        /Unsupported protocol|Invalid URL/,
      );
    });
  });

  describe("given a target whose host is decided by the conversation", () => {
    /**
     * The URL is a Liquid template rendered against the scenario's own message
     * context, so what the simulated user says reaches the host portion. The
     * guard therefore has to see the rendered URL and not the template —
     * otherwise a scenario is a way to have a model choose an address inside
     * the cluster, and the stored template looks harmless in review.
     */
    it("refuses the host the conversation produced, not the template it came from", async () => {
      await expect(
        callWith({
          url: "http://{{ input }}/latest/meta-data/",
          said: "169.254.169.254",
        }),
      ).rejects.toThrow(REFUSED_BY_POLICY);
    });

    /**
     * The control for the case above: the same template with a benign host
     * gets *past* the policy check, so that test is failing on the address
     * rather than on templating or on the guard refusing everything.
     */
    it("does not refuse a benign host on policy grounds", async () => {
      // `.invalid` is reserved by RFC 2606 and never resolves, so this stops
      // at DNS without a socket — the point is only which error it is NOT.
      await expect(
        callWith({ url: "http://{{ input }}/chat", said: "agent.invalid" }),
      ).rejects.not.toThrow(REFUSED_BY_POLICY);
    });
  });

  describe("when the guard refuses a target", () => {
    /**
     * The refusal has to reach the run's terminal event as something a user can
     * act on. A blank failure reads as "the platform broke" rather than "this
     * agent URL points somewhere it may not".
     */
    it("says why, rather than failing blankly", async () => {
      await expect(
        callWith({ url: "http://169.254.169.254/latest/meta-data/" }),
      ).rejects.toThrow(/cloud metadata endpoints/);
    });
  });
});

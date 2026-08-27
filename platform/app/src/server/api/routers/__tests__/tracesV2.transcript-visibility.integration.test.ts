/**
 * @vitest-environment node
 *
 * The captured-content matrix for `GET /api/traces/:traceId/transcript`.
 *
 * An API-key caller has no session, so the data-privacy policy resolves it as
 * a public viewer: only a `capture` category is readable, `restrict` and `drop`
 * are not. This suite drives the REAL policy resolution (postgres) into the
 * REAL transcript read, and pins what content survives per cell.
 *
 * It covers every agent wire shape, not just claude's, because the log gate
 * matches `event.name` while the transcript derivation normalizes it: claude
 * emits bare names (`user_prompt`), codex and gemini namespace theirs
 * (`codex.tool_result`, `gemini_cli.api_response`). A gate that only knows the
 * bare spelling hands a session-less caller the namespaced agents' content
 * whatever the policy says.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "~/generated/prisma/client";

import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestProject } from "../../../../utils/testUtils";
import type { DataPrivacyConfig } from "../../../data-privacy/dataPrivacy.types";
import { getDataPrivacyPolicyService } from "../../../data-privacy/dataPrivacyPolicy.service";
import { prisma } from "../../../db";
import { getProtectionsForProject } from "../../utils";
import { TestCodingAgentService } from "~/test-utils/test-coding-agent.service";

const TRACE_ID = "a3c6656cf433e97549f654034be02955";
const NAMESPACE = "transcript-visibility";

const USER_PROMPT_SECRET = "acme merger memo, do not disclose";
const ASSISTANT_REPLY_SECRET = "the board vote is 7 to 2 against";
const TOOL_ARGS_SECRET = "SELECT * FROM salaries WHERE level > 8";
const TOOL_OUTPUT_SECRET = "cfo total compensation 1.4 million";
const codingAgents = TestCodingAgentService.create();

const { mockGetSpansByTraceId, mockGetLogsByTraceId } = vi.hoisted(() => ({
  mockGetSpansByTraceId: vi.fn(),
  mockGetLogsByTraceId: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    traces: {
      spans: { getSpansByTraceId: mockGetSpansByTraceId },
      logRecords: { getLogsByTraceId: mockGetLogsByTraceId },
    },
  }),
}));

import { readCodingAgentTranscriptWithProtections } from "../tracesV2";

/**
 * Anchored to now so the plan visibility window never teases the fixture: the
 * window is a separate gate and would mask what this suite measures.
 */
const NOW = Date.now();

function logRow(attributes: Record<string, string>, offsetMs: number) {
  return {
    traceId: TRACE_ID,
    spanId: "77bb432be48046f6",
    timeUnixMs: NOW + offsetMs,
    // Claude stamps the event-name marker on the OTLP body; the gate treats a
    // body that merely echoes the marker as metadata, not content.
    body: attributes["event.name"] ?? "",
    attributes,
    resourceAttributes: { "service.name": "claude-code" },
    scopeName: "com.anthropic.claude_code.events",
    scopeVersion: null,
  };
}

/** Claude Code: bare event names, prompt on `prompt`, reply on `response`. */
const CLAUDE_LOGS = [
  logRow({ "event.name": "user_prompt", prompt: USER_PROMPT_SECRET }, 100),
  logRow({ "event.name": "assistant_response", response: ASSISTANT_REPLY_SECRET }, 300),
];

/** gemini-cli: `gemini_cli.`-namespaced, reply on `response_text`. */
const GEMINI_LOGS = [
  logRow({ "event.name": "gemini_cli.user_prompt", prompt: USER_PROMPT_SECRET }, 100),
  logRow(
    {
      "event.name": "gemini_cli.api_response",
      role: "main",
      response_text: JSON.stringify({
        candidates: [{ content: { parts: [{ text: ASSISTANT_REPLY_SECRET }] } }],
      }),
    },
    300,
  ),
];

/** codex: `codex.`-namespaced, tool content on `arguments` / `output`. */
const CODEX_LOGS = [
  logRow({ "event.name": "codex.user_prompt", prompt: USER_PROMPT_SECRET }, 100),
  logRow(
    {
      "event.name": "codex.tool_result",
      call_id: "call_1",
      tool_name: "shell",
      arguments: JSON.stringify({ command: TOOL_ARGS_SECRET }),
      output: TOOL_OUTPUT_SECRET,
      success: "true",
    },
    300,
  ),
];

describe("transcript captured-content matrix for an API-key caller", () => {
  const service = getDataPrivacyPolicyService();
  let project: Project;
  let organizationId: string;

  beforeAll(async () => {
    project = await getTestProject(NAMESPACE);
    const team = await prisma.team.findUniqueOrThrow({
      where: { id: project.teamId },
      select: { organizationId: true },
    });
    organizationId = team.organizationId;
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockGetSpansByTraceId.mockResolvedValue([]);
    await cleanupTestRows(prisma, [["dataPrivacyPolicy", { organizationId }]]);
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [["dataPrivacyPolicy", { organizationId }]]);
  });

  async function setPolicy(config: DataPrivacyConfig) {
    await service.setForScope({
      scope: { scopeType: "PROJECT", scopeId: project.id },
      personalOnly: false,
      config,
    });
  }

  /** The exact path the REST route takes: protections for a project, no session. */
  async function transcriptAsApiKeyCaller(logs: unknown[]) {
    mockGetLogsByTraceId.mockResolvedValue(logs);
    const protections = await getProtectionsForProject(prisma, {
      projectId: project.id,
    });
    return readCodingAgentTranscriptWithProtections({
      projectId: project.id,
      traceId: TRACE_ID,
      occurredAtMs: NOW,
      protections,
      codingAgents,
    });
  }

  async function documentFor(logs: unknown[]) {
    return JSON.stringify(await transcriptAsApiKeyCaller(logs));
  }

  describe("when both categories are captured (the permissive default)", () => {
    /** @scenario transcript endpoint serves captured content to an API key caller */
    it("serves the prompt and the reply for every agent wire shape", async () => {
      const claude = await documentFor(CLAUDE_LOGS);
      expect(claude).toContain(USER_PROMPT_SECRET);
      expect(claude).toContain(ASSISTANT_REPLY_SECRET);

      const gemini = await documentFor(GEMINI_LOGS);
      expect(gemini).toContain(USER_PROMPT_SECRET);
      expect(gemini).toContain(ASSISTANT_REPLY_SECRET);

      const codex = await documentFor(CODEX_LOGS);
      expect(codex).toContain(USER_PROMPT_SECRET);
      expect(codex).toContain(TOOL_OUTPUT_SECRET);
    });
  });

  describe("when captured output is restricted", () => {
    beforeEach(async () => {
      await setPolicy({
        categories: {
          output: { disposition: "restrict", audience: { admins: true } },
        },
      });
    });

    /** @scenario transcript endpoint withholds restricted output from an API key caller */
    it("withholds the assistant reply from a session-less caller", async () => {
      expect(await documentFor(CLAUDE_LOGS)).not.toContain(ASSISTANT_REPLY_SECRET);
      expect(await documentFor(GEMINI_LOGS)).not.toContain(ASSISTANT_REPLY_SECRET);
    });

    it("still serves tool arguments, which the policy leaves captured", async () => {
      expect(await documentFor(CODEX_LOGS)).toContain(TOOL_ARGS_SECRET);
    });

    /** @scenario transcript endpoint withholds restricted tool output from an API key caller */
    it("withholds tool output, which quotes what the agent read back", async () => {
      expect(await documentFor(CODEX_LOGS)).not.toContain(TOOL_OUTPUT_SECRET);
    });

    it("still serves the prompt, which the policy leaves captured", async () => {
      expect(await documentFor(CLAUDE_LOGS)).toContain(USER_PROMPT_SECRET);
    });
  });

  describe("when captured input is restricted", () => {
    beforeEach(async () => {
      await setPolicy({
        categories: {
          input: { disposition: "restrict", audience: { admins: true } },
        },
      });
    });

    /** @scenario transcript endpoint withholds restricted input from an API key caller */
    it("withholds the user prompt for every agent wire shape", async () => {
      expect(await documentFor(CLAUDE_LOGS)).not.toContain(USER_PROMPT_SECRET);
      expect(await documentFor(GEMINI_LOGS)).not.toContain(USER_PROMPT_SECRET);
      expect(await documentFor(CODEX_LOGS)).not.toContain(USER_PROMPT_SECRET);
    });

    /** @scenario transcript endpoint withholds restricted tool arguments from an API key caller */
    it("withholds tool arguments, which carry what the agent was asked to run", async () => {
      expect(await documentFor(CODEX_LOGS)).not.toContain(TOOL_ARGS_SECRET);
    });

    it("still serves the assistant reply, which the policy leaves captured", async () => {
      expect(await documentFor(CLAUDE_LOGS)).toContain(ASSISTANT_REPLY_SECRET);
    });
  });

  describe("when both categories are dropped", () => {
    beforeEach(async () => {
      await setPolicy({
        categories: {
          input: { disposition: "drop" },
          output: { disposition: "drop" },
        },
      });
    });

    /** @scenario transcript endpoint withholds every content category a drop policy covers */
    it("withholds every content payload, whatever the agent", async () => {
      for (const logs of [CLAUDE_LOGS, GEMINI_LOGS, CODEX_LOGS]) {
        const document = await documentFor(logs);
        expect(document).not.toContain(USER_PROMPT_SECRET);
        expect(document).not.toContain(ASSISTANT_REPLY_SECRET);
        expect(document).not.toContain(TOOL_ARGS_SECRET);
        expect(document).not.toContain(TOOL_OUTPUT_SECRET);
      }
    });
  });
});

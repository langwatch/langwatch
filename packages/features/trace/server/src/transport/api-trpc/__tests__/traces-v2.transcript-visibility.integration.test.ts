/**
 * @vitest-environment node
 *
 * The captured-content matrix for `GET /api/traces/:traceId/transcript`.
 *
 * An API-key caller has no session, so the data-privacy policy resolves it as
 * a public viewer: only a `capture` category is readable, `restrict` and `drop`
 * are not. This suite drives the REAL policy resolution into the REAL
 * transcript read, and pins what content survives per cell.
 *
 * It covers every agent wire shape, not just claude's, because the log gate
 * matches `event.name` while the transcript derivation normalizes it: claude
 * emits bare names (`user_prompt`), codex and gemini namespace theirs
 * (`codex.tool_result`, `gemini_cli.api_response`). A gate that only knows the
 * bare spelling hands a session-less caller the namespaced agents' content
 * whatever the policy says.
 *
 * ## What this suite reaches, and what it cannot
 *
 * The policy stored for a scope becomes a `ResolvedDataPrivacy` through
 * `resolveDataPrivacy`, and a public viewer's per-category decision comes from
 * `isContentVisibleToPublic` — both the real functions the API process runs,
 * both owned by the data-privacy contract this package depends on. The one
 * step this package cannot reach is the process's `getApiKeyProtections`
 * (`ApiTraceProtections` in `apps/api/src/app/api-trace-read-stack.composition.ts`,
 * a private class): it is what CHOOSES the anonymous branch for a key, and it
 * resolves the policy out of Postgres. So the projection below stands where the
 * suite's predecessor read a stored row, and what stays unguarded here is the
 * API process picking the wrong branch for a key — an apps/api binding, not one
 * this package can hold.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTENT_CATEGORIES,
  describeAudience,
  isContentVisibleToPublic,
  resolveDataPrivacy,
  type DataPrivacyConfig,
  type DataPrivacyRow,
  type DataPrivacyScopeFacts,
  type ResolvedCategory,
} from "@langwatch/data-privacy-contract";
import type { Protections } from "../../../services/trace-viewer-protections.service";
import { TestCodingAgentService } from "../../../services/__tests__/support/coding-agent.service.fake";
import { TracesV2TrpcApi } from "../traces-v2.api";
import { createTranscriptApp, createTranscriptReadPorts } from "./support/transcript-read.support";

const TRACE_ID = "a3c6656cf433e97549f654034be02955";
const PROJECT_ID = "project_transcript_visibility";

const USER_PROMPT_SECRET = "acme merger memo, do not disclose";
const ASSISTANT_REPLY_SECRET = "the board vote is 7 to 2 against";
const TOOL_ARGS_SECRET = "SELECT * FROM salaries WHERE level > 8";
const TOOL_OUTPUT_SECRET = "cfo total compensation 1.4 million";
const codingAgents = new TestCodingAgentService();

const { app, getSpansByTraceId, getLogsByTraceId } = createTranscriptApp(codingAgents);
const ports = createTranscriptReadPorts();

/** The project the policy is stored against, as the resolution chain reads it. */
const SCOPE_FACTS: DataPrivacyScopeFacts = {
  organizationId: "organization_transcript_visibility",
  teamId: "team_transcript_visibility",
  projectId: PROJECT_ID,
  departmentId: null,
  isPersonal: false,
};

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

/** The audience label a `restrict` rule carries onto a hidden placeholder. */
function restrictLabelFor(category: ResolvedCategory): string | null {
  return category.disposition === "restrict"
    ? describeAudience(category.audience, { groups: {} })
    : null;
}

describe("transcript captured-content matrix for an API-key caller", () => {
  let policy: DataPrivacyConfig | null = null;

  beforeEach(() => {
    policy = null;
    getSpansByTraceId.mockReset();
    getLogsByTraceId.mockReset();
    getSpansByTraceId.mockResolvedValue([]);
  });

  function setPolicy(config: DataPrivacyConfig) {
    policy = config;
  }

  /** The project's stored policy, as the resolution chain receives it. */
  function storedRows(): DataPrivacyRow[] {
    return policy === null
      ? []
      : [{ scopeType: "PROJECT", scopeId: PROJECT_ID, personalOnly: false, config: policy }];
  }

  /**
   * The protections a project API key resolves to: the anonymous branch of
   * every content category, with costs put back because every project role
   * grants `cost:view` and a project key carries full project access.
   */
  function apiKeyProtections(): Protections {
    const resolved = resolveDataPrivacy({ rows: storedRows(), facts: SCOPE_FACTS });
    const categories = Object.fromEntries(
      CONTENT_CATEGORIES.map((category) => [
        category,
        {
          canSee: isContentVisibleToPublic(resolved.categories[category]),
          restrictVisibleTo: restrictLabelFor(resolved.categories[category]),
        },
      ]),
    ) as NonNullable<Protections["contentCategories"]>;

    return {
      canSeeCosts: true,
      canSeeCapturedInput: categories.input.canSee,
      canSeeCapturedOutput: categories.output.canSee,
      capturedInputVisibleTo: categories.input.restrictVisibleTo,
      capturedOutputVisibleTo: categories.output.restrictVisibleTo,
      contentCategories: categories,
      visibilityCutoffMs: null,
    };
  }

  /** The exact path the REST route takes: protections for a project, no session. */
  async function transcriptAsApiKeyCaller(logs: unknown[]) {
    getLogsByTraceId.mockResolvedValue(logs);
    return TracesV2TrpcApi.readCodingAgentTranscript({
      app,
      ports,
      projectId: PROJECT_ID,
      traceId: TRACE_ID,
      occurredAtMs: NOW,
      protections: apiKeyProtections(),
      codingAgents,
    });
  }

  async function documentFor(logs: unknown[]) {
    return JSON.stringify(await transcriptAsApiKeyCaller(logs));
  }

  describe("when both categories are captured (the permissive default)", () => {
    /** @scenario "transcript endpoint serves captured content to an API key caller" */
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
    beforeEach(() => {
      setPolicy({
        categories: {
          output: { disposition: "restrict", audience: { admins: true } },
        },
      });
    });

    /** @scenario "transcript endpoint withholds restricted output from an API key caller" */
    it("withholds the assistant reply from a session-less caller", async () => {
      expect(await documentFor(CLAUDE_LOGS)).not.toContain(ASSISTANT_REPLY_SECRET);
      expect(await documentFor(GEMINI_LOGS)).not.toContain(ASSISTANT_REPLY_SECRET);
    });

    it("still serves tool arguments, which the policy leaves captured", async () => {
      expect(await documentFor(CODEX_LOGS)).toContain(TOOL_ARGS_SECRET);
    });

    /** @scenario "transcript endpoint withholds restricted tool output from an API key caller" */
    it("withholds tool output, which quotes what the agent read back", async () => {
      expect(await documentFor(CODEX_LOGS)).not.toContain(TOOL_OUTPUT_SECRET);
    });

    it("still serves the prompt, which the policy leaves captured", async () => {
      expect(await documentFor(CLAUDE_LOGS)).toContain(USER_PROMPT_SECRET);
    });
  });

  describe("when captured input is restricted", () => {
    beforeEach(() => {
      setPolicy({
        categories: {
          input: { disposition: "restrict", audience: { admins: true } },
        },
      });
    });

    /** @scenario "transcript endpoint withholds restricted input from an API key caller" */
    it("withholds the user prompt for every agent wire shape", async () => {
      expect(await documentFor(CLAUDE_LOGS)).not.toContain(USER_PROMPT_SECRET);
      expect(await documentFor(GEMINI_LOGS)).not.toContain(USER_PROMPT_SECRET);
      expect(await documentFor(CODEX_LOGS)).not.toContain(USER_PROMPT_SECRET);
    });

    /** @scenario "transcript endpoint withholds restricted tool arguments from an API key caller" */
    it("withholds tool arguments, which carry what the agent was asked to run", async () => {
      expect(await documentFor(CODEX_LOGS)).not.toContain(TOOL_ARGS_SECRET);
    });

    it("still serves the assistant reply, which the policy leaves captured", async () => {
      expect(await documentFor(CLAUDE_LOGS)).toContain(ASSISTANT_REPLY_SECRET);
    });
  });

  describe("when both categories are dropped", () => {
    beforeEach(() => {
      setPolicy({
        categories: {
          input: { disposition: "drop" },
          output: { disposition: "drop" },
        },
      });
    });

    /** @scenario "transcript endpoint withholds every content category a drop policy covers" */
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

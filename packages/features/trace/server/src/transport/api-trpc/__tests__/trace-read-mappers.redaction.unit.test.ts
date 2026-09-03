import { describe, expect, it } from "vitest";
import type { TraceLogRecordDto } from "@langwatch/trace-contract";
import type { ContentCategory } from "@langwatch/data-privacy-contract";
import {
  buildContentPrivacy,
  contentSearchTermsForViewer,
  gateTraceLogVisibility as gateTraceLogVisibilityWithService,
  redactTraceLogContent as redactTraceLogContentWithService,
  redactV2Content as redactV2ContentWithPorts,
  type CategoryVisibility,
  type TraceContentPrivacyPort,
  type V2Protections,
} from "../trace-read-mappers.api";
import {
  CONTENT_KEY_CATALOG,
  PRIVACY_DROPPED_MARKER_ATTR,
  PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
} from "@langwatch/data-privacy-contract";
import { ContentDropPolicyService } from "@langwatch/data-privacy-server";

/** The packaged chat-array stripper the ingestion path applies. */
const dropPolicy = ContentDropPolicyService.create();
import { TestCodingAgentService } from "../../../services/__tests__/support/coding-agent.service.fake";

/**
 * The data-privacy vocabulary the mappers take as a port, wired to the REAL
 * catalog and chat-turn stripper so these assertions still cover the keys
 * ingestion actually classifies. Only the resolved-policy read is absent —
 * nothing here derives the trace-level DROP banner.
 */
const contentPrivacy: TraceContentPrivacyPort = {
  contentKeyCatalog: CONTENT_KEY_CATALOG,
  droppedMarkerAttribute: PRIVACY_DROPPED_MARKER_ATTR,
  piiIncompleteMarkerAttribute: PRIVACY_PII_INCOMPLETE_MARKER_ATTR,
  stripRolesFromChatArrayJson: (json, roles, stripToolCalls) =>
    dropPolicy.tryStripRolesFromChatArrayJson(json, roles, stripToolCalls),
  getResolvedPolicyForProject: () => {
    throw new Error("the resolved data-privacy policy is not read by these cases");
  },
};

const DERIVED_ATTR_PREFIXES = {
  input: "langwatch.gen_ai.input.",
  output: "langwatch.gen_ai.output.",
} as const;

function redactV2Content<
  T extends {
    input?: string | null;
    output?: string | null;
    inputRedacted?: boolean | null;
    outputRedacted?: boolean | null;
    inputVisibleTo?: string | null;
    outputVisibleTo?: string | null;
    inputMediaRefs?: unknown;
    outputMediaRefs?: unknown;
    attributes?: Record<string, string>;
    params?: Record<string, unknown> | null;
  },
>(dto: T, protections: V2Protections) {
  return redactV2ContentWithPorts(dto, protections, contentPrivacy);
}

const visible: CategoryVisibility = { canSee: true, restrictVisibleTo: null };
const codingAgents = new TestCodingAgentService();

type LogProtections = {
  canSeeCapturedInput?: boolean | null;
  canSeeCapturedOutput?: boolean | null;
  capturedInputVisibleTo?: string | null;
  capturedOutputVisibleTo?: string | null;
};

function redactTraceLogContent(
  row: TraceLogRecordDto,
  protections: LogProtections,
): TraceLogRecordDto {
  return redactTraceLogContentWithService(row, protections, codingAgents, DERIVED_ATTR_PREFIXES);
}

function gateTraceLogVisibility(
  row: TraceLogRecordDto,
  protections: LogProtections,
  visibilityCutoffMs: number | null,
): TraceLogRecordDto {
  return gateTraceLogVisibilityWithService(
    row,
    protections,
    visibilityCutoffMs,
    codingAgents,
    DERIVED_ATTR_PREFIXES,
  );
}

/** A full per-category visibility map, all visible unless overridden. */
function cats(
  overrides: Partial<Record<ContentCategory, CategoryVisibility>> = {},
): Record<ContentCategory, CategoryVisibility> {
  return {
    input: { ...visible },
    output: { ...visible },
    system: { ...visible },
    tools: { ...visible },
    ...overrides,
  };
}

const restricted = (visibleTo: string | null): CategoryVisibility => ({
  canSee: false,
  restrictVisibleTo: visibleTo,
});

const restrictedVisible = (visibleTo: string): CategoryVisibility => ({
  canSee: true,
  restrictVisibleTo: visibleTo,
});

describe("redactV2Content", () => {
  describe("given the viewer cannot see captured input", () => {
    it("nulls the input and keeps the output", () => {
      const out = redactV2Content(
        { input: "hello", output: "world" },
        { canSeeCapturedInput: false, canSeeCapturedOutput: true },
      );

      expect(out.input).toBeNull();
      expect(out.output).toBe("world");
    });
  });

  describe("given hidden custom attribute rules for the viewer", () => {
    const protections = {
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
      hiddenAttributes: [{ pattern: "app.billing.*", visibleTo: "Admins" }],
    };

    /** @scenario A restricted custom attribute is hidden from outside the audience */
    it("redacts matching span params, flat header attributes, and event attributes", () => {
      const out = redactV2Content(
        {
          input: "hello",
          output: "world",
          attributes: { "app.billing.card_token": "tok", "service.name": "x" },
          params: {
            app: { billing: { card_token: "tok" } },
            model: "gpt-5-mini",
          },
          events: [
            {
              name: "e1",
              attributes: { "app.billing.plan": "pro", keep: "yes" },
            },
          ],
        },
        protections,
      );

      expect(out.attributes?.["app.billing.card_token"]).toBe("[REDACTED] (visible to Admins)");
      expect(out.attributes?.["service.name"]).toBe("x");
      expect(
        (out.params as { app: { billing: { card_token: string } } }).app.billing.card_token,
      ).toBe("[REDACTED] (visible to Admins)");
      expect((out.params as { model: string }).model).toBe("gpt-5-mini");
      const event = (
        out as unknown as {
          events: Array<{ attributes: Record<string, unknown> }>;
        }
      ).events[0]!;
      expect(event.attributes["app.billing.plan"]).toBe("[REDACTED] (visible to Admins)");
      expect(event.attributes.keep).toBe("yes");
    });

    it("leaves the privacy drop markers untouched", () => {
      const out = redactV2Content(
        {
          input: null,
          output: null,
          attributes: {
            "langwatch.privacy.dropped": "input",
            "langwatch.privacy.dropped_attributes": "app.internal.session",
          },
        },
        protections,
      );

      expect(out.attributes?.["langwatch.privacy.dropped"]).toBe("input");
      expect(out.attributes?.["langwatch.privacy.dropped_attributes"]).toBe("app.internal.session");
    });
  });

  describe("given a restrict rule hides content from the viewer", () => {
    it("flags the field redacted and carries the audience label", () => {
      const out = redactV2Content(
        { input: "secret prompt", output: "secret answer" },
        {
          canSeeCapturedInput: false,
          canSeeCapturedOutput: false,
          capturedInputVisibleTo: "Admins, Security group",
          capturedOutputVisibleTo: "Admins, Security group",
        },
      );

      expect(out.input).toBeNull();
      expect(out.inputRedacted).toBe(true);
      expect(out.inputVisibleTo).toBe("Admins, Security group");
      expect(out.outputRedacted).toBe(true);
      expect(out.outputVisibleTo).toBe("Admins, Security group");
    });

    it("does not flag a genuinely empty field as redacted", () => {
      const out = redactV2Content(
        { input: null, output: "world" },
        { canSeeCapturedInput: false, canSeeCapturedOutput: true },
      );

      expect(out.inputRedacted).toBe(false);
      expect(out.inputVisibleTo).toBeNull();
      expect(out.outputRedacted).toBe(false);
    });

    it("does not flag content the viewer is allowed to see", () => {
      const out = redactV2Content(
        { input: "hello" },
        { canSeeCapturedInput: true, canSeeCapturedOutput: true },
      );

      expect(out.input).toBe("hello");
      expect(out.inputRedacted).toBe(false);
    });
  });

  describe("given no hidden attributes", () => {
    it("does not touch params or attributes", () => {
      const params = { a: 1 };
      const out = redactV2Content(
        { input: "x", output: "y", params },
        { canSeeCapturedInput: true, canSeeCapturedOutput: true },
      );

      expect(out.params).toBe(params);
    });
  });

  describe("given the trace carries extracted media references", () => {
    const withRefs = () => ({
      input: "voice call",
      output: "transcript",
      inputMediaRefs: [{ kind: "audio", url: "/api/files/p1/a1" }],
      outputMediaRefs: [{ kind: "audio", url: "/api/files/p1/a2" }],
      attributes: {
        "langwatch.reserved.media_refs.input": `[{"kind":"audio","url":"/api/files/p1/a1"}]`,
        "langwatch.reserved.media_refs.output": `[{"kind":"audio","url":"/api/files/p1/a2"}]`,
        "service.name": "x",
      },
    });

    describe("when the viewer cannot see captured input", () => {
      /** @scenario Redacted trace content never leaks its media references */
      it("drops the input refs and reserved input attribute, keeps the output ones", () => {
        const out = redactV2Content(withRefs(), {
          canSeeCapturedInput: false,
          canSeeCapturedOutput: true,
        });

        // The whole point: the /api/files URLs are fetchable on their own, so
        // they must not ride along in the payload for redacted content.
        expect(out.inputMediaRefs).toBeUndefined();
        expect(out.attributes?.["langwatch.reserved.media_refs.input"]).toBeUndefined();
        expect(out.outputMediaRefs).toEqual([{ kind: "audio", url: "/api/files/p1/a2" }]);
        expect(out.attributes?.["langwatch.reserved.media_refs.output"]).toBe(
          `[{"kind":"audio","url":"/api/files/p1/a2"}]`,
        );
        expect(out.attributes?.["service.name"]).toBe("x");
      });
    });

    describe("when the viewer cannot see captured output", () => {
      it("drops the output refs and reserved output attribute", () => {
        const out = redactV2Content(withRefs(), {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: false,
        });

        expect(out.outputMediaRefs).toBeUndefined();
        expect(out.attributes?.["langwatch.reserved.media_refs.output"]).toBeUndefined();
        expect(out.inputMediaRefs).toEqual([{ kind: "audio", url: "/api/files/p1/a1" }]);
      });
    });

    describe("when the viewer sees everything", () => {
      it("keeps both ref fields and both reserved attributes", () => {
        const out = redactV2Content(withRefs(), {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
        });

        expect(out.inputMediaRefs).toBeDefined();
        expect(out.outputMediaRefs).toBeDefined();
        expect(out.attributes?.["langwatch.reserved.media_refs.input"]).toBeDefined();
        expect(out.attributes?.["langwatch.reserved.media_refs.output"]).toBeDefined();
      });
    });
  });

  describe("given system instructions are restricted from the viewer", () => {
    const conversation = JSON.stringify({
      type: "chat_messages",
      value: [
        { role: "system", content: "secret instructions" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });

    it("strips the system turn from the visible conversation", () => {
      const out = redactV2Content(
        { input: conversation },
        {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          contentCategories: cats({ system: restricted("Admins") }),
        },
      );

      const parsed = JSON.parse(out.input!) as {
        value: Array<{ role: string }>;
      };
      expect(parsed.value.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(out.input).not.toContain("secret instructions");
    });

    it("replaces the standalone system-instructions attribute with the audience placeholder", () => {
      const out = redactV2Content(
        {
          input: null,
          params: {
            gen_ai: { system_instructions: "secret" },
            model: "gpt-5-mini",
          },
        },
        {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          contentCategories: cats({ system: restricted("Admins") }),
        },
      );

      const params = out.params as {
        gen_ai: { system_instructions: string };
        model: string;
      };
      expect(params.gen_ai.system_instructions).toBe("[REDACTED] (visible to Admins)");
      expect(params.model).toBe("gpt-5-mini");
    });
  });

  describe("given tool calls are restricted from the viewer", () => {
    /** @scenario Tool calls restricted to a group are visible to that group and hidden from others */
    it("strips tool turns and assistant tool_calls, keeping user and assistant text", () => {
      const conversation = JSON.stringify([
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "calling",
          tool_calls: [{ id: "1", function: { name: "lookup" } }],
        },
        { role: "tool", content: "tool result" },
      ]);

      const out = redactV2Content(
        { input: conversation },
        {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          contentCategories: cats({ tools: restricted("Security group") }),
        },
      );

      const parsed = JSON.parse(out.input!) as Array<{
        role: string;
        tool_calls?: unknown;
      }>;
      expect(parsed.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(parsed[1]!.tool_calls).toBeUndefined();
      expect(out.input).not.toContain("tool result");
    });

    it("strips the hidden turns from the raw chat-array attributes too (nested params and flat attributes)", () => {
      const messages = [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "1", function: { name: "lookup" } }],
        },
        { role: "tool", content: "SECRET tool result" },
      ];
      const out = redactV2Content(
        {
          input: null,
          // Nested params (the span mapper unflattens dotted keys).
          params: { gen_ai: { input: { messages } } },
          // Flat attributes carry the conversation as a JSON string.
          attributes: { "gen_ai.input.messages": JSON.stringify(messages) },
        },
        {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          contentCategories: cats({ tools: restricted("Admins") }),
        },
      );

      const paramsMessages = (
        out.params as {
          gen_ai: { input: { messages: Array<{ role: string }> } };
        }
      ).gen_ai.input.messages;
      expect(paramsMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(JSON.stringify(out.params)).not.toContain("SECRET tool result");
      expect(JSON.stringify(out.params)).not.toContain("tool_calls");
      expect(out.attributes?.["gen_ai.input.messages"]).not.toContain("SECRET tool result");
    });
  });
});

describe("buildContentPrivacy", () => {
  /** @scenario Each dropped category is marked where its content would appear */
  it("marks a dropped category as dropped, distinct from a restriction", () => {
    const privacy = buildContentPrivacy({ contentCategories: cats() }, new Set(["system"]));
    expect(privacy.system).toEqual({ state: "dropped", visibleTo: null });
  });

  it("marks a restricted-hidden category and names who can see it", () => {
    const privacy = buildContentPrivacy(
      { contentCategories: cats({ tools: restricted("Admins") }) },
      new Set(),
    );
    expect(privacy.tools).toEqual({ state: "restricted", visibleTo: "Admins" });
  });

  it("marks restricted-but-visible content so an in-audience viewer is told", () => {
    const privacy = buildContentPrivacy(
      { contentCategories: cats({ input: restrictedVisible("Admins") }) },
      new Set(),
    );
    expect(privacy.input).toEqual({ state: "visible", visibleTo: "Admins" });
  });

  it("leaves plainly captured content unmarked", () => {
    const privacy = buildContentPrivacy({ contentCategories: cats() }, new Set());
    expect(privacy.output).toEqual({ state: "visible", visibleTo: null });
  });

  it("lets a drop win over a restriction on the same category", () => {
    const privacy = buildContentPrivacy(
      { contentCategories: cats({ system: restricted("Admins") }) },
      new Set(["system"]),
    );
    expect(privacy.system.state).toBe("dropped");
  });
});

/**
 * R2 security gap: the `traceLogs` procedure returned raw log bodies (captured
 * prompts / responses) with NO content-privacy enforcement, unlike the sibling
 * span endpoints. `redactTraceLogContent` closes that — a viewer without
 * captured-input / captured-output visibility must not read the raw content
 * through this procedure.
 */
describe("redactTraceLogContent", () => {
  function logRow(
    attributes: Record<string, string>,
    body = attributes["event.name"] ?? "",
  ): TraceLogRecordDto {
    return {
      spanId: "77bb432be48046f6",
      timeUnixMs: 100,
      body,
      attributes,
      resourceAttributes: { "langwatch.origin": "coding_agent" },
      scopeName: "com.anthropic.claude_code.events",
      scopeVersion: null,
    };
  }

  // Real wire shapes: on the default (LIGHT) telemetry path Claude Code puts
  // the prompt under the `prompt` attribute and the reply under `response` —
  // NOT under `body`, which only the opt-in RAW `api_*_body` events use. The
  // fixtures must match that or they green-light a redaction that strips the
  // one key these records never carry.
  const userPrompt = logRow({
    "event.name": "user_prompt",
    query_source: "repl_main_thread",
    prompt: "summarise the private repo",
  });
  const assistantResponse = logRow({
    "event.name": "assistant_response",
    request_id: "req_1",
    query_source: "repl_main_thread",
    response: "Here is the secret summary.",
  });
  const apiResponseBody = logRow({
    "event.name": "api_response_body",
    request_id: "req_1",
    body: '{"content":[{"type":"text","text":"Here is the secret summary."}]}',
    // Stamped at ingest by deriveLogContentAttributes — captured output,
    // re-shaped, so it must fall with the body.
    "langwatch.gen_ai.output.text": "Here is the secret summary.",
    "langwatch.gen_ai.output.tool_calls": '[{"id":"t1","name":"Bash"}]',
    "langwatch.gen_ai.output.tool_call_count": "1",
    "langwatch.gen_ai.response.stop_reason": "tool_use",
  });
  const apiRequestBody = logRow({
    "event.name": "api_request_body",
    request_id: "req_1",
    body: '{"messages":[{"role":"user","content":"summarise the private repo"}]}',
    "langwatch.gen_ai.input.message_count": "1",
  });

  describe("given a viewer without captured-content visibility", () => {
    const blind = { canSeeCapturedInput: false, canSeeCapturedOutput: false };

    it("withholds the prompt of a default-path user_prompt record", () => {
      const out = redactTraceLogContent(userPrompt, blind);

      expect(out.attributes.prompt).toBeUndefined();
      expect(out.bodyRedacted).toBe(true);
      expect(JSON.stringify(out)).not.toContain("summarise the private repo");
    });

    it("withholds the reply of a default-path assistant_response record", () => {
      const out = redactTraceLogContent(assistantResponse, blind);

      expect(out.attributes.response).toBeUndefined();
      expect(out.bodyRedacted).toBe(true);
      expect(JSON.stringify(out)).not.toContain("Here is the secret summary.");
    });

    it("withholds the raw response body AND the ingest-derived output attrs", () => {
      const out = redactTraceLogContent(apiResponseBody, blind);

      expect(out.attributes.body).toBeUndefined();
      expect(out.attributes["langwatch.gen_ai.output.text"]).toBeUndefined();
      expect(out.attributes["langwatch.gen_ai.output.tool_calls"]).toBeUndefined();
      expect(out.attributes["langwatch.gen_ai.output.tool_call_count"]).toBeUndefined();
      // Operational metadata, not content — passes through like cost_usd.
      expect(out.attributes["langwatch.gen_ai.response.stop_reason"]).toBe("tool_use");
      expect(out.bodyRedacted).toBe(true);
      expect(JSON.stringify(out)).not.toContain("Here is the secret summary.");
    });

    it("withholds the raw request body and its derived input attrs", () => {
      const out = redactTraceLogContent(apiRequestBody, blind);

      expect(out.attributes.body).toBeUndefined();
      expect(out.attributes["langwatch.gen_ai.input.message_count"]).toBeUndefined();
      expect(JSON.stringify(out)).not.toContain("summarise the private repo");
    });

    it("keeps the record's metadata (event name, request id, cost)", () => {
      const anchor = logRow({
        "event.name": "api_request",
        request_id: "req_1",
        cost_usd: "0.0421",
      });

      const out = redactTraceLogContent(anchor, blind);

      // The cost anchor carries no content body, so it passes through intact —
      // cost is governed by its own permission, not captured-content visibility.
      expect(out.attributes.cost_usd).toBe("0.0421");
      expect(out.attributes["event.name"]).toBe("api_request");
      expect(out.bodyRedacted).toBeUndefined();
    });

    it("carries the restrict audience label for a restricted input", () => {
      const out = redactTraceLogContent(userPrompt, {
        canSeeCapturedInput: false,
        canSeeCapturedOutput: false,
        capturedInputVisibleTo: "Admins, Security group",
      });

      expect(out.bodyVisibleTo).toBe("Admins, Security group");
    });

    it("fails closed on an unclassified content-of-record body", () => {
      // A generic emitter with content in the top-level body and no event.name.
      const generic = logRow({ some_attr: "x" }, "raw secret content");

      const out = redactTraceLogContent(generic, blind);

      expect(out.body).toBe("");
      expect(out.bodyRedacted).toBe(true);
    });
  });

  describe("given a viewer with full captured-content visibility", () => {
    const full = { canSeeCapturedInput: true, canSeeCapturedOutput: true };

    it("returns the prompt unchanged", () => {
      const out = redactTraceLogContent(userPrompt, full);

      expect(out.attributes.prompt).toBe("summarise the private repo");
      expect(out.bodyRedacted).toBeUndefined();
    });

    it("returns the reply and its derived output attrs unchanged", () => {
      const out = redactTraceLogContent(assistantResponse, full);
      expect(out.attributes.response).toBe("Here is the secret summary.");
      expect(out.bodyRedacted).toBeUndefined();

      const raw = redactTraceLogContent(apiResponseBody, full);
      expect(raw.attributes["langwatch.gen_ai.output.text"]).toBe("Here is the secret summary.");
      expect(raw.bodyRedacted).toBeUndefined();
    });
  });

  describe("given input is visible but output is not", () => {
    const inputOnly = {
      canSeeCapturedInput: true,
      canSeeCapturedOutput: false,
    };

    it("reveals the prompt but withholds the response", () => {
      expect(redactTraceLogContent(userPrompt, inputOnly).attributes.prompt).toBe(
        "summarise the private repo",
      );
      expect(
        redactTraceLogContent(assistantResponse, inputOnly).attributes.response,
      ).toBeUndefined();
    });
  });

  /**
   * Only Claude Code emits bare event names. codex and gemini namespace theirs,
   * and the transcript derivation resolves both through the canonical
   * vocabulary — so the gate has to as well, or a namespaced record matches no
   * known content key and leaves with its payload intact.
   */
  describe("given a namespaced agent's wire spelling", () => {
    const blind = { canSeeCapturedInput: false, canSeeCapturedOutput: false };
    const inputOnly = {
      canSeeCapturedInput: true,
      canSeeCapturedOutput: false,
    };
    const outputOnly = {
      canSeeCapturedInput: false,
      canSeeCapturedOutput: true,
    };

    const codexPrompt = logRow({
      "event.name": "codex.user_prompt",
      prompt: "summarise the private repo",
    });
    const codexToolResult = logRow({
      "event.name": "codex.tool_result",
      call_id: "call_1",
      tool_name: "shell",
      arguments: '{"command":"cat /etc/private"}',
      output: "the secret file contents",
      success: "true",
    });
    const geminiResponse = logRow({
      "event.name": "gemini_cli.api_response",
      role: "main",
      response_text: '{"candidates":[{"content":{"parts":[{"text":"secret"}]}}]}',
    });

    it("withholds a codex prompt behind captured-input visibility", () => {
      expect(redactTraceLogContent(codexPrompt, blind).attributes.prompt).toBeUndefined();
      expect(redactTraceLogContent(codexPrompt, inputOnly).attributes.prompt).toBe(
        "summarise the private repo",
      );
    });

    it("withholds a gemini reply behind captured-output visibility", () => {
      expect(redactTraceLogContent(geminiResponse, blind).attributes.response_text).toBeUndefined();
      expect(
        redactTraceLogContent(geminiResponse, inputOnly).attributes.response_text,
      ).toBeUndefined();
      expect(redactTraceLogContent(geminiResponse, outputOnly).attributes.response_text).toBe(
        '{"candidates":[{"content":{"parts":[{"text":"secret"}]}}]}',
      );
    });

    /**
     * One record, two categories: the arguments are what the agent was asked to
     * run, the output is what came back. A single verdict for the record could
     * only ever be right in one direction.
     */
    it("gates a codex tool run's arguments and output independently", () => {
      const hidOutput = redactTraceLogContent(codexToolResult, inputOnly);
      expect(hidOutput.attributes.arguments).toBe('{"command":"cat /etc/private"}');
      expect(hidOutput.attributes.output).toBeUndefined();
      // The flag is what makes the UI say "content withheld" rather than
      // render an empty record as "nothing happened here".
      expect(hidOutput.bodyRedacted).toBe(true);

      const hidInput = redactTraceLogContent(codexToolResult, outputOnly);
      expect(hidInput.attributes.arguments).toBeUndefined();
      expect(hidInput.attributes.output).toBe("the secret file contents");
      expect(hidInput.bodyRedacted).toBe(true);

      const hidBoth = redactTraceLogContent(codexToolResult, blind);
      expect(hidBoth.attributes.arguments).toBeUndefined();
      expect(hidBoth.attributes.output).toBeUndefined();
      expect(hidBoth.bodyRedacted).toBe(true);
      // Metadata survives: which tool ran, and whether it worked.
      expect(hidBoth.attributes.tool_name).toBe("shell");
      expect(hidBoth.attributes.success).toBe("true");
    });

    it("names no audience when a record shed both categories at once", () => {
      const out = redactTraceLogContent(codexToolResult, {
        ...blind,
        capturedInputVisibleTo: "Admins",
        capturedOutputVisibleTo: "Admins",
      });

      expect(out.bodyVisibleTo).toBeNull();
    });
  });
});

/**
 * R2 teaser window: the sibling span reads teaser-redact spans older than the
 * free-plan visibility cutoff, but the `traceLogs` read applied only the
 * captured-content permission gate — so a free-plan viewer WITH captured-content
 * permission could read raw prompts / responses older than their window through
 * the logs endpoint, a bypass of the teaser the span reads enforce.
 * `gateTraceLogVisibility` closes that.
 */
describe("gateTraceLogVisibility", () => {
  function logRow(
    attributes: Record<string, string>,
    timeUnixMs: number,
    body = attributes.body ?? attributes["event.name"] ?? "",
  ): TraceLogRecordDto {
    return {
      spanId: "77bb432be48046f6",
      timeUnixMs,
      body,
      attributes,
      resourceAttributes: { "langwatch.origin": "coding_agent" },
      scopeName: "com.anthropic.claude_code.events",
      scopeVersion: null,
    };
  }

  const full = { canSeeCapturedInput: true, canSeeCapturedOutput: true };
  const CUTOFF = 1_000;

  describe("given a free-plan cutoff and a record older than the window", () => {
    // Real wire key: assistant_response carries its reply on `response`.
    const stale = logRow(
      { "event.name": "assistant_response", response: "old private answer" },
      CUTOFF - 1,
    );

    it("withholds the content even for a viewer allowed to see it", () => {
      const out = gateTraceLogVisibility(stale, full, CUTOFF);

      expect(out.attributes.response).toBeUndefined();
      expect(out.bodyRedacted).toBe(true);
      expect(JSON.stringify(out)).not.toContain("old private answer");
    });

    it("offers no audience label — a plan gate is not an audience gate", () => {
      const out = gateTraceLogVisibility(
        stale,
        { ...full, capturedOutputVisibleTo: "Admins" },
        CUTOFF,
      );

      expect(out.bodyVisibleTo).toBeNull();
    });

    it("keeps a stale cost anchor's metadata (no content body to withhold)", () => {
      const anchor = logRow(
        { "event.name": "api_request", request_id: "req_1", cost_usd: "0.19" },
        CUTOFF - 1,
      );

      const out = gateTraceLogVisibility(anchor, full, CUTOFF);

      expect(out.attributes.cost_usd).toBe("0.19");
      expect(out.bodyRedacted).toBeUndefined();
    });
  });

  describe("given a free-plan cutoff and a record inside the window", () => {
    const fresh = logRow(
      { "event.name": "assistant_response", response: "recent answer" },
      CUTOFF + 1,
    );

    it("falls through to the viewer's captured-content permission", () => {
      expect(gateTraceLogVisibility(fresh, full, CUTOFF).attributes.response).toBe("recent answer");
      expect(
        gateTraceLogVisibility(
          fresh,
          { canSeeCapturedInput: false, canSeeCapturedOutput: false },
          CUTOFF,
        ).attributes.response,
      ).toBeUndefined();
    });
  });

  describe("given a paid plan with no window (cutoff null)", () => {
    it("leaves the permission gate in sole control, even for an old record", () => {
      const old = logRow({ "event.name": "assistant_response", response: "answer" }, 1);

      expect(gateTraceLogVisibility(old, full, null).attributes.response).toBe("answer");
    });
  });
});

describe("contentSearchTermsForViewer", () => {
  const TERMS = ["#6418"];

  describe("given a viewer who may read the whole transcript", () => {
    /** @scenario A viewer allowed the whole transcript still searches it */
    it("matches the terms against the transcript bodies", () => {
      expect(
        contentSearchTermsForViewer({
          terms: TERMS,
          protections: {
            canSeeCapturedInput: true,
            canSeeCapturedOutput: true,
            contentCategories: cats(),
          },
        }),
      ).toEqual(TERMS);
    });
  });

  describe("given a viewer whose captured content is hidden", () => {
    /** @scenario A viewer who cannot read captured content cannot search it */
    it("drops the terms when the input is hidden", () => {
      expect(
        contentSearchTermsForViewer({
          terms: TERMS,
          protections: {
            canSeeCapturedInput: false,
            canSeeCapturedOutput: true,
            contentCategories: cats(),
          },
        }),
      ).toEqual([]);
    });

    /** @scenario A viewer who cannot read captured content cannot search it */
    it("drops the terms when the output is hidden", () => {
      expect(
        contentSearchTermsForViewer({
          terms: TERMS,
          protections: {
            canSeeCapturedInput: true,
            canSeeCapturedOutput: false,
            contentCategories: cats(),
          },
        }),
      ).toEqual([]);
    });

    // The flags default to undefined, which is not `true`, so an unpopulated
    // protections object must read as "no transcript reach" rather than as a
    // viewer who may see everything.
    /** @scenario A viewer who cannot read captured content cannot search it */
    it("drops the terms when the flags were never set", () => {
      expect(contentSearchTermsForViewer({ terms: TERMS, protections: {} })).toEqual([]);
    });
  });

  describe("given a viewer with a transcript category hidden", () => {
    /** @scenario A viewer with a hidden transcript category cannot search it */
    it("drops the terms when system turns are hidden", () => {
      expect(
        contentSearchTermsForViewer({
          terms: TERMS,
          protections: {
            canSeeCapturedInput: true,
            canSeeCapturedOutput: true,
            contentCategories: cats({ system: restricted(null) }),
          },
        }),
      ).toEqual([]);
    });

    /** @scenario A viewer with a hidden transcript category cannot search it */
    it("drops the terms when tool turns are hidden", () => {
      expect(
        contentSearchTermsForViewer({
          terms: TERMS,
          protections: {
            canSeeCapturedInput: true,
            canSeeCapturedOutput: true,
            contentCategories: cats({ tools: restricted(null) }),
          },
        }),
      ).toEqual([]);
    });
  });

  describe("given a viewer with a custom attribute rule hidden from them", () => {
    // hiddenAttributes redacts by KEY (attributes/params), but the transcript
    // search matches a substring against log_records' AttributesFlatJson,
    // which is the whole flattened blob, no per-key scoping possible. A term
    // that only appears inside the hidden attribute's value would still light
    // up a match, the same oracle the category checks above exist to prevent.
    /** @scenario A viewer with a hidden custom attribute cannot search it */
    it("drops the terms even though input, output and every category are visible", () => {
      expect(
        contentSearchTermsForViewer({
          terms: TERMS,
          protections: {
            canSeeCapturedInput: true,
            canSeeCapturedOutput: true,
            contentCategories: cats(),
            hiddenAttributes: [{ pattern: "app.billing.*", visibleTo: "Admins" }],
          },
        }),
      ).toEqual([]);
    });
  });
});

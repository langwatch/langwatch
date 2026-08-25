/**
 * The contract these pin is narrow but load-bearing: whatever comes off the
 * wire, a customer never reads a code slug, a server message, or a raw meta
 * dump (ADR-045 + #5984).
 */
import { goErrorCodes, nodeErrorCodes } from "@langwatch/handled-error";
import { describe, expect, it } from "vitest";

import { APP_ERROR_CODES } from "../codes";
import {
  explainHandledError,
  explainSerializedError,
  UNKNOWN_ERROR_PRESENTATION,
} from "../presentation";
import type { HandledErrorShape } from "../readHandledError";

/** Every code the registry must cover — app + generated Go + generated node. */
const ALL_CODES = [
  ...APP_ERROR_CODES,
  ...Object.keys(goErrorCodes),
  ...Object.keys(nodeErrorCodes),
];

const shape = (overrides: Partial<HandledErrorShape> = {}): HandledErrorShape => ({
  code: "trace_not_found",
  meta: {},
  httpStatus: 404,
  fault: "customer",
  tips: [],
  docsUrl: undefined,
  traceId: undefined,
  reasons: [],
  ...overrides,
});

describe("ALL_CODES", () => {
  /**
   * `codes.generated.ts` is written by `cmd/herrgen`. A regeneration that
   * emitted an empty object would leave every cross-cutting loop below
   * iterating nothing and reporting a pass — the exhaustive `satisfies` in
   * `presentation.ts` would go quiet at the same time, since a `Record` over
   * `never` is satisfied by anything.
   */
  it("covers the generated code sets, not just the hand-written one", () => {
    expect(
      Object.keys(goErrorCodes).length,
      "goErrorCodes is empty — codes.generated.ts looks stale or truncated. Run `make herrgen`.",
    ).toBeGreaterThan(0);
    expect(
      Object.keys(nodeErrorCodes).length,
      "nodeErrorCodes is empty — codes.generated.ts looks stale or truncated. Run `make herrgen`.",
    ).toBeGreaterThan(0);
  });
});

describe("explainHandledError", () => {
  describe("given a code the registry knows", () => {
    /** @scenario "A recognised code is described by the registry, never by the wire" */
    it("uses the registry copy rather than anything off the wire", () => {
      const { title, description } = explainHandledError(
        shape({ code: "query_timeout" }),
      );

      expect(title).toBe("This search took too long");
      expect(description).toContain("Narrow the time range");
    });

    /** @scenario "meta is read only where the client knows its shape" */
    it("reads meta only where the registry declares the shape", () => {
      const { description } = explainHandledError(
        shape({
          code: "filter_field_unknown",
          meta: { field: "trace.durationn" },
        }),
      );

      expect(description).toBe('There\'s no field called "trace.durationn".');
    });

    /** @scenario "meta is read only where the client knows its shape" */
    it("falls back cleanly when the declared meta is absent", () => {
      const { title, description } = explainHandledError(
        shape({ code: "filter_field_unknown", meta: {} }),
      );

      expect(title).toBe("Unknown filter field");
      expect(description).toBe("");
    });

    /** @scenario "meta is read only where the client knows its shape" */
    it("ignores meta of the wrong type rather than rendering it", () => {
      const { description } = explainHandledError(
        shape({ code: "filter_field_unknown", meta: { field: { nope: 1 } } }),
      );

      expect(description).toBe("");
    });

    /** @scenario "A missing-model rejection is explained per the surface that raised it" */
    it.each([
      ["chat", "POST /v1/chat/completions"],
      ["messages", "POST /v1/messages"],
      ["responses", "POST /v1/responses"],
      ["embeddings", "POST /v1/embeddings"],
      ["speech", "POST /v1/audio/speech"],
      ["transcription", "multipart form"],
      ["passthrough", "Gemini request URL"],
    ])("explains where a %s request expects its model", (requestType, expected) => {
      const { description } = explainHandledError(
        shape({ code: "missing_model", meta: { request_type: requestType } }),
      );

      expect(description).toContain(expected);
    });

    /** @scenario "A missing-model rejection is explained per the surface that raised it" */
    it("uses surface-neutral missing-model copy for an unknown request type", () => {
      const { description } = explainHandledError(
        shape({
          code: "missing_model",
          meta: { request_type: "future_surface" },
        }),
      );

      expect(description).toBe(
        "Set the model where this endpoint expects it, then try again.",
      );
    });
  });

  describe("when a seat allowance is what ran out", () => {
    /** @scenario Running out of Lite Member seats names that allowance */
    it("names which seats ran out and the reversible way to free one", () => {
      const { description } = explainHandledError(
        shape({
          code: "resource_limit_exceeded",
          httpStatus: 403,
          meta: { limitType: "membersLite", current: 3, max: 3 },
        }),
      );

      // An admin reaching this is reconciling down to their plan, so "upgrade"
      // on its own is the one answer they came here to avoid.
      expect(description).toContain("Lite Member seats");
      expect(description).toContain("disable a membership");
      expect(description).toContain("reversible");
    });

    /** @scenario Running out of Lite Member seats names that allowance */
    it("names the full member seats when those are the ones in use", () => {
      const { description } = explainHandledError(
        shape({
          code: "resource_limit_exceeded",
          httpStatus: 403,
          meta: { limitType: "members", current: 15, max: 15 },
        }),
      );

      expect(description).toContain("full member seats");
    });

    it("keeps the generic plan-limit line for every other allowance", () => {
      const { description } = explainHandledError(
        shape({
          code: "resource_limit_exceeded",
          httpStatus: 403,
          meta: { limitType: "messagesPerMonth" },
        }),
      );

      expect(description).toBe("Upgrade your plan to raise it.");
    });
  });

  describe("when a team would be left without an admin", () => {
    /** @scenario Refusing to leave a team without an admin names the team */
    it("names the team and the one step that clears it", () => {
      const { description } = explainHandledError(
        shape({
          code: "team_last_admin_required",
          httpStatus: 409,
          meta: { teamName: "developers" },
        }),
      );

      expect(description).toContain('"developers"');
      expect(description).toContain("Admin role");
    });

    /** @scenario Refusing to leave a team without an admin names the team */
    it("still says something useful when the team has no name to give", () => {
      const { description } = explainHandledError(
        shape({ code: "team_last_admin_required", httpStatus: 409, meta: {} }),
      );

      expect(description).toContain("This team");
      expect(description).not.toContain("undefined");
    });

    /** @scenario Being the last admin oneself is a different sentence */
    it("tells the last admin of a team to promote somebody before leaving it", () => {
      const { description } = explainHandledError(
        shape({
          code: "cannot_remove_self_as_last_admin",
          httpStatus: 409,
          meta: { teamName: "developers" },
        }),
      );

      expect(description).toContain('"developers"');
      expect(description).toContain("first");
      // Nobody can do this for them, so copy that points at somebody else is
      // pointing at the reader.
      expect(description).not.toMatch(/ask|contact|support/i);
    });

    /** @scenario A Lite Member seat that only allows Viewer says so as itself */
    it("explains that the seat is what limits the team role", () => {
      const { description } = explainHandledError(
        shape({
          code: "lite_member_viewer_only",
          httpStatus: 409,
          meta: { teamName: "developers" },
        }),
      );

      expect(description).toContain("Viewer");
      expect(description).toContain("full member seat");
    });

    /** @scenario None of these refusals reach the customer as check-your-input */
    it.each([
      "team_last_admin_required",
      "cannot_remove_self_as_last_admin",
      "lite_member_viewer_only",
    ])("does not present %s as a bad input", (code) => {
      const { title, description } = explainHandledError(
        shape({ code, httpStatus: 409, meta: {} }),
      );

      // What each of these used to read as, before they carried a code of their
      // own: the sentence the server wrote was dropped on the wire and the
      // registry had only `validation_error` left to go on.
      expect(title).not.toBe("Check your input");
      expect(description).not.toContain("Some of the values aren't valid");
    });
  });

  describe("given a code the registry has never seen", () => {
    /**
     * The fallback used to be `FAULT_TITLES[fault]`, which is a guess dressed
     * as a fact: `fault` defaults to `customer` server-side, so a platform
     * failure on a payload that predates the field told the customer to "check
     * your input", and a `provider` fault told them "a connected service
     * didn't respond" about their own Python error. The code is the one thing
     * we actually know, and a customer can quote it to support.
     */
    /** @scenario "An unrecognised code degrades to the code itself, not to a guess at the fault" */
    it("degrades to the code itself rather than a guess at whose fault it is", () => {
      const { title, isRegistered } = explainHandledError(
        shape({ code: "dataset_import_stalled" }),
      );

      expect(title).toBe("Dataset import stalled");
      expect(isRegistered).toBe(false);
    });

    /** @scenario "An unrecognised code degrades to the code itself, not to a guess at the fault" */
    it("says the same thing whatever the fault claims", () => {
      const titleFor = (fault: HandledErrorShape["fault"] | undefined) =>
        explainHandledError(
          shape({ code: "dataset_import_stalled", fault: fault ?? "customer" }),
        ).title;

      expect(titleFor("provider")).toBe("Dataset import stalled");
      expect(titleFor("platform")).toBe("Dataset import stalled");
      // An older payload with no fault at all: the reader defaults it to
      // `customer`, which is exactly the case that used to read "Check your
      // input" for a failure the customer had no part in.
      expect(titleFor(undefined)).toBe("Dataset import stalled");
    });

    /** @scenario "An unrecognised code renders no prose at all" */
    it("renders nothing from meta.message for a code it has no entry for", () => {
      // The inverse of what this asserted before. An unrecognised code is the
      // branch with the least standing to render a sentence: the client has no
      // entry for it, so it cannot say which service minted it, whether the
      // prose was written for a customer, or whether it is a provider body
      // relayed through a hop nobody can see. Rendering it anyway is how an
      // upstream's words — and whatever they quote — reach LangWatch's own
      // error chrome unread.
      //
      // Empty is the correct answer: callers fall back to the server's first
      // remediation tip, then to the generic line and a trace id. The fix for a
      // code that lands here often is to give it an entry.
      const { description, isRegistered } = explainHandledError(
        shape({
          code: "some_future_code",
          meta: { message: "The widget is out of stock." },
        }),
      );

      expect(isRegistered).toBe(false);
      expect(description).toBe("");
    });
  });

  describe("given a failure with no code at all", () => {
    /** @scenario "An unrecognised code degrades to the code itself, not to a guess at the fault" */
    it("falls back on fault, which is then the only thing known about it", () => {
      const { title, isRegistered } = explainHandledError(
        shape({ code: "", fault: "platform" }),
      );

      expect(title).toBe("Something went wrong on our end");
      expect(isRegistered).toBe(false);
    });
  });

  describe("given a mediated LLM call the gateway forwarded from a provider", () => {
    const reason = (code: string) => ({ code, kind: code });

    /** @scenario "A provider-refused credential gets its own remediation copy" */
    it.each(["upstream_unauthorized", "upstream_forbidden"])(
      "explains a %s reason as a rejected credential",
      (code) => {
        const { description } = explainHandledError(
          shape({ code: "llm_upstream_error", reasons: [reason(code)] }),
        );

        expect(description).toContain("key or its permissions");
      },
    );

    /** @scenario "A provider rate limit gets its own remediation copy" */
    it("explains an upstream_rate_limited reason as a wait-and-retry", () => {
      const { description } = explainHandledError(
        shape({
          code: "llm_upstream_error",
          reasons: [reason("upstream_rate_limited")],
        }),
      );

      expect(description).toContain("rate-limiting");
    });

    /** @scenario "A provider outage gets its own remediation copy" */
    it.each(["upstream_unavailable", "upstream_timeout"])(
      "explains a %s reason as a provider outage",
      (code) => {
        const { description } = explainHandledError(
          shape({ code: "llm_upstream_error", reasons: [reason(code)] }),
        );

        expect(description).toContain("temporarily unavailable");
      },
    );

    /** @scenario "An unrecognised upstream reason falls back to the generic retry line" */
    it("falls back to the generic line for a reason it does not classify", () => {
      const { description } = explainHandledError(
        shape({
          code: "llm_upstream_error",
          reasons: [reason("some_new_provider_code")],
        }),
      );

      expect(description).toBe("Try again, or pick a different model.");
    });
  });

  describe("given a validation error naming fields", () => {
    it("never names a field the customer can't see", () => {
      // zod flattens to the INPUT SCHEMA's keys, so every procedure's
      // `projectId` shows up. Naming it is the same leak as a code slug.
      const { description } = explainHandledError(
        shape({
          code: "validation_error",
          httpStatus: 422,
          meta: {
            fieldErrors: { projectId: ["Required"], checkId: ["Required"] },
          },
        }),
      );

      expect(description).not.toContain("projectId");
      expect(description).not.toContain("checkId");
      expect(description).toBe("Some of the values aren't valid.");
    });

    /**
     * `fieldErrors` keys come off the wire, so they reach a bare index lookup
     * as untrusted input. `constructor` resolved to `Object` — truthy, so it
     * passed the label filter — and the customer read "There's a problem with
     * function Object() { [native code] }".
     */
    it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
      "declines %s as a field name rather than resolving it on the prototype",
      (field) => {
        const { description } = explainHandledError(
          shape({
            code: "validation_error",
            httpStatus: 422,
            meta: { fieldErrors: { [field]: ["Required"] } },
          }),
        );

        expect(description).toBe("Some of the values aren't valid.");
      },
    );

    it("declines a prototype key on the single-field code too", () => {
      const { description } = explainHandledError(
        shape({ code: "schema_failure", meta: { field: "constructor" } }),
      );

      expect(description).toBe("Some of the values aren't valid.");
    });

    it("declines a prototype key where the evaluator names its field", () => {
      const { description } = explainHandledError(
        shape({ code: "evaluator_missing_field", meta: { field: "toString" } }),
      );

      expect(description).toBe("Map all of its required fields before running it.");
    });

    it("names the model when the rejected field is the per-send modelOverride", () => {
      // The Langy composer sends the picked model as `modelOverride`; the
      // customer is looking at a model picker, so the card says "the model".
      const { title, description } = explainHandledError(
        shape({
          code: "validation_error",
          httpStatus: 422,
          meta: {
            fieldErrors: {
              modelOverride: ["modelOverride must be in 'provider/model' shape"],
            },
          },
        }),
      );

      expect(title).toBe("Check your input");
      expect(description).toBe("There's a problem with the model.");
    });

    it("names them the way the screen does, not the way the schema does", () => {
      // `slug` is the wire key; the field the user is looking at is labelled
      // "URL slug". Quoting the key back reads as a different thing entirely.
      const { title, description } = explainHandledError(
        shape({
          code: "validation_error",
          httpStatus: 422,
          meta: { fieldErrors: { name: ["Required"], slug: ["Taken"] } },
        }),
      );

      expect(title).toBe("Check your input");
      expect(description).toBe("There's a problem with the name and the URL slug.");
    });
  });

  describe("given a node failure carrying the upstream's status", () => {
    /**
     * The engine attaches `meta.upstreamStatus` for every node code that can
     * have one. Without reading it, an expired key, a rate limit and a
     * provider outage all read identically — and only one of the three is
     * something the customer can act on.
     */
    it.each([
      ["llm_error", 401, /API key/i],
      ["llm_error", 429, /rate limiting/i],
      ["llm_error", 503, /trouble/i],
      ["evaluator_error", 403, /API key/i],
      ["agent_workflow_error", 429, /rate limiting/i],
      ["custom_workflow_error", 500, /trouble/i],
    ])("tells %s at %i what to do about it", (code, status, expected) => {
      const { description } = explainHandledError(
        shape({ code, meta: { upstreamStatus: status } }),
      );

      expect(description).toMatch(expected);
    });

    it("keeps the general advice when no status came with it", () => {
      const { description } = explainHandledError(shape({ code: "llm_error" }));

      expect(description).toBe("Try again, or check the node's model configuration.");
    });
  });

  describe("given an evaluator that failed on a rejected key", () => {
    /**
     * Two producers, two spellings: the experiments-v3 mapper sets
     * `reason: "auth_failed"`, the langevals HTTP client attaches only
     * `meta.httpStatus`. Reading one meant half of these said "try running it
     * again" — advice that cannot work on a rejected key.
     */
    it.each([
      ["the mapper's reason", { reason: "auth_failed" }],
      ["the HTTP client's 401", { httpStatus: 401 }],
      ["the HTTP client's 403", { httpStatus: 403 }],
    ])("points at the key for %s", (_label, meta) => {
      const { description } = explainHandledError(
        shape({ code: "evaluator_execution_error", meta }),
      );

      expect(description).toBe("Check the API key for this evaluator's model provider.");
    });

    it("says to retry for a failure that isn't about credentials", () => {
      const { description } = explainHandledError(
        shape({ code: "evaluator_execution_error", meta: { httpStatus: 502 } }),
      );

      expect(description).toBe("Try running it again.");
    });
  });

  describe("given a coded failure serialised on an event payload", () => {
    /** @scenario "A workflow node failure reaches the customer as a code, not a Go string" */
    it("explains it from the registry, not from its raw message", () => {
      // A target_result.domainError, as the engine's http_error arrives.
      const { title } = explainSerializedError({
        code: "http_error",
        kind: "http_error",
        meta: {},
        traceId: undefined,
        spanId: undefined,
        httpStatus: 502,
        fault: "provider",
        reasons: [],
      });

      expect(title).toBe("Couldn't reach the agent");
    });
  });

  describe("across every registered code", () => {
    it("never renders the code itself as the title", () => {
      for (const code of ALL_CODES) {
        const { title, description } = explainHandledError(shape({ code }));

        expect(title, `${code} title`).not.toContain(code);
        expect(title, `${code} title`).not.toMatch(/^[a-z0-9]+(_[a-z0-9]+)+$/);
        expect(description, `${code} description`).not.toContain(code);
      }
    });

    /** @scenario "Technical detail stops at the trace id" */
    it("never renders a value the server put in meta", () => {
      // The leak this module exists to stop can re-enter through `meta` just
      // as easily as through `message`: a machine sub-classifier
      // ("auth_failed"), a wire identifier ("projectId"), a connection string.
      // Feed every code a poisoned meta and assert none of it reaches the copy.
      const poison = {
        reason: "auth_failed",
        message: "connect ECONNREFUSED 10.0.0.4:5432",
        field: "projectId",
        query: "SELECT * FROM traces",
        syntaxError: "at line 4: unexpected token",
        recipient: "ops-oncall@internal.example",
        channel: "#platform-alerts-internal",
        upstreamHost: "clickhouse-0.internal",
        fieldErrors: { projectId: ["Required"], organizationId: ["Required"] },
      };

      /**
       * Codes allowed to echo one specific meta field, with the reason.
       *
       * Narrower than {@link ALLOWED_ECHOES}: an exemption that applies to
       * every code is a hole, and `meta.message` is the field a relayed Go
       * service can write, so it is named per code and nowhere else.
       *
       * Every entry left here is prose LangWatch AUTHORED. `llm_upstream_error`
       * used to sit alongside them as the one admitted relay — the model
       * provider's own rejection, on the grounds that it is the same sentence
       * the provider's SDK shows its caller. That is true only for the caller
       * who owns the key; for a mediated call the caller is us, and OpenAI
       * writes rejected keys into exactly this field. It echoes nothing now, so
       * the list is once again only our own words.
       */
      const ALLOWED_PER_CODE: Record<string, Set<string>> = {
        // The provider's own reason for rejecting delivery is the entire
        // value of this error — "invite the bot with /invite @LangWatch".
        // Authored server-side by `explainSlackPostError`, never relayed.
        notification_delivery_error: new Set(["message"]),
        // Here `reason` is not a machine sub-classifier: it is the sentence
        // the service wrote for this exact case ("This automation has no email
        // recipients to test-fire to."), and it names WHICH piece is missing.
        // Authored in `trigger-template.service.ts`, never relayed.
        test_fire_unavailable: new Set(["reason"]),
      };

      /**
       * Values ANY registry entry may echo, each with its reason.
       *
       * An exemption is a decision, so it is written down rather than
       * expressed as an absence from the poison list — the previous version of
       * this test asserted against four hand-picked strings, which meant the
       * three entries that DO render meta verbatim (`syntaxError`,
       * `recipient`, `channel`) were never checked at all and the test
       * reported a coverage it didn't have.
       */
      const ALLOWED_ECHOES: Record<string, string> = {
        // The user typed this filter field themselves; naming it back is the
        // whole point of `filter_field_unknown`.
        field: "echoed by filter_field_unknown, and it is the user's own input",
        // The user pasted the template/config being validated, so the parser's
        // position is the only thing that makes the error actionable.
        syntaxError: "echoed by template_validation_error, from user input",
        // The user chose the destination; naming it is how they know which
        // one to fix.
        recipient: "echoed by the notification codes, chosen by the user",
        channel: "echoed by the notification codes, chosen by the user",
      };

      for (const code of ALL_CODES) {
        const { title, description } = explainHandledError(shape({ code, meta: poison }));
        const rendered = `${title} ${description}`;

        for (const [key, value] of Object.entries(poison)) {
          if (typeof value !== "string") continue;
          if (key in ALLOWED_ECHOES) continue;
          if (ALLOWED_PER_CODE[code]?.has(key)) continue;

          expect(
            rendered,
            `${code} rendered meta.${key} ("${value}") to the customer. If that ` +
              `is deliberate, add it to ALLOWED_ECHOES with the reason.`,
          ).not.toContain(value);
        }
      }
    });

    it("declines a code that resolves to an inherited property", () => {
      // `code` is untrusted. A bare index lookup finds Object.prototype
      // members, which are truthy — that reported itself as registered copy
      // and rendered a blank headline.
      for (const code of ["toString", "constructor", "hasOwnProperty"]) {
        const { title, isRegistered } = explainHandledError(
          shape({ code, fault: "platform" }),
        );

        expect(isRegistered, code).toBe(false);
        expect(title.length, code).toBeGreaterThan(0);
      }
    });

    it("writes a non-empty, sentence-cased title", () => {
      for (const code of ALL_CODES) {
        const { title } = explainHandledError(shape({ code }));

        expect(title.length, `${code} title`).toBeGreaterThan(0);
        expect(title[0], `${code} title`).toBe(title[0]?.toUpperCase());
        expect(title.endsWith("."), `${code} title`).toBe(false);
      }
    });
  });
});

describe("UNKNOWN_ERROR_PRESENTATION", () => {
  /** @scenario "An unhandled failure says nothing, but stays traceable" */
  it("says nothing about what actually failed", () => {
    expect(UNKNOWN_ERROR_PRESENTATION.title).toBe("Something went wrong");
    expect(UNKNOWN_ERROR_PRESENTATION.description).not.toMatch(
      /prisma|sql|postgres|clickhouse|undefined|null/i,
    );
  });
});

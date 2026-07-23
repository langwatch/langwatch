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

const shape = (
  overrides: Partial<HandledErrorShape> = {},
): HandledErrorShape => ({
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

describe("explainHandledError", () => {
  describe("given a code the registry knows", () => {
    it("uses the registry copy rather than anything off the wire", () => {
      const { title, description } = explainHandledError(
        shape({ code: "query_timeout" }),
      );

      expect(title).toBe("This search took too long");
      expect(description).toContain("Narrow the time range");
    });

    it("reads meta only where the registry declares the shape", () => {
      const { description } = explainHandledError(
        shape({
          code: "filter_field_unknown",
          meta: { field: "trace.durationn" },
        }),
      );

      expect(description).toBe('There\'s no field called "trace.durationn".');
    });

    it("falls back cleanly when the declared meta is absent", () => {
      const { title, description } = explainHandledError(
        shape({ code: "filter_field_unknown", meta: {} }),
      );

      expect(title).toBe("Unknown filter field");
      expect(description).toBe("");
    });

    it("ignores meta of the wrong type rather than rendering it", () => {
      const { description } = explainHandledError(
        shape({ code: "filter_field_unknown", meta: { field: { nope: 1 } } }),
      );

      expect(description).toBe("");
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
    it("degrades to the code itself rather than a guess at whose fault it is", () => {
      const { title, isRegistered } = explainHandledError(
        shape({ code: "dataset_import_stalled" }),
      );

      expect(title).toBe("Dataset import stalled");
      expect(isRegistered).toBe(false);
    });

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

    it("renders server prose only from the explicit meta.message channel", () => {
      const { description } = explainHandledError(
        shape({
          code: "some_future_code",
          meta: { message: "The widget is out of stock." },
        }),
      );

      expect(description).toBe("The widget is out of stock.");
    });
  });

  describe("given a failure with no code at all", () => {
    it("falls back on fault, which is then the only thing known about it", () => {
      const { title, isRegistered } = explainHandledError(
        shape({ code: "", fault: "platform" }),
      );

      expect(title).toBe("Something went wrong on our end");
      expect(isRegistered).toBe(false);
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
      expect(description).toBe(
        "There's a problem with the name and the URL slug.",
      );
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

      expect(description).toBe(
        "Try again, or check the node's model configuration.",
      );
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

      expect(description).toBe(
        "Check the API key for this evaluator's model provider.",
      );
    });

    it("says to retry for a failure that isn't about credentials", () => {
      const { description } = explainHandledError(
        shape({ code: "evaluator_execution_error", meta: { httpStatus: 502 } }),
      );

      expect(description).toBe("Try running it again.");
    });
  });

  describe("given a coded failure serialised on an event payload", () => {
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
       * service can write, so exactly one code may render it.
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
        const { title, description } = explainHandledError(
          shape({ code, meta: poison }),
        );
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
  it("says nothing about what actually failed", () => {
    expect(UNKNOWN_ERROR_PRESENTATION.title).toBe("Something went wrong");
    expect(UNKNOWN_ERROR_PRESENTATION.description).not.toMatch(
      /prisma|sql|postgres|clickhouse|undefined|null/i,
    );
  });
});

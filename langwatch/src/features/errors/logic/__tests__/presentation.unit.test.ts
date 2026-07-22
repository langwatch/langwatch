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
    it("falls back on fault rather than showing the code", () => {
      const customer = explainHandledError(
        shape({ code: "some_future_code", fault: "customer" }),
      );
      const platform = explainHandledError(
        shape({ code: "some_future_code", fault: "platform" }),
      );

      expect(customer.title).toBe("Check your input");
      expect(platform.title).toBe("Something went wrong on our end");
      expect(customer.title).not.toContain("some_future_code");
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

    it("says which ones", () => {
      const { title, description } = explainHandledError(
        shape({
          code: "validation_error",
          httpStatus: 422,
          meta: { fieldErrors: { name: ["Required"], slug: ["Taken"] } },
        }),
      );

      expect(title).toBe("Check your input");
      expect(description).toBe('There\'s a problem with "name" and "slug".');
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
       * Values a registry entry is allowed to echo, each with its reason.
       *
       * An exemption is a decision, so it is written down here rather than
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

          expect(
            rendered,
            `${code} rendered meta.${key} ("${value}") to the customer. If that ` +
              `is deliberate, add it to ALLOWED_ECHOES with the reason.`,
          ).not.toContain(value);
        }
      }
    });

    it("degrades on fault for a code that resolves to an inherited property", () => {
      // `code` is untrusted. A bare index lookup finds Object.prototype
      // members, which are truthy — that reported itself as registered copy
      // and rendered a blank headline.
      for (const code of ["toString", "constructor", "hasOwnProperty"]) {
        const { title } = explainHandledError(
          shape({ code, fault: "platform" }),
        );
        expect(title, code).toBe("Something went wrong on our end");
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

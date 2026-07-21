/**
 * The contract these pin is narrow but load-bearing: whatever comes off the
 * wire, a customer never reads a code slug, a server message, or a raw meta
 * dump (ADR-045 + #5984).
 */
import { describe, expect, it } from "vitest";

import { APP_ERROR_CODES } from "../codes";
import { UNKNOWN_ERROR_PRESENTATION, explainHandledError } from "../presentation";
import type { HandledErrorShape } from "../readHandledError";

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

  describe("when the validation error names fields", () => {
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

  describe("across every registered code", () => {
    it("never renders the code itself as the title", () => {
      for (const code of APP_ERROR_CODES) {
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
        fieldErrors: { projectId: ["Required"], organizationId: ["Required"] },
      };

      for (const code of APP_ERROR_CODES) {
        const { title, description } = explainHandledError(
          shape({ code, meta: poison }),
        );
        const rendered = `${title} ${description}`;

        // Values that could only have come from the server. Deliberately not
        // `field` — echoing back a filter field the user typed themselves is
        // correct, and `filter_field_unknown` does exactly that.
        for (const leaked of [
          "auth_failed",
          "ECONNREFUSED",
          "10.0.0.4",
          "SELECT",
        ]) {
          expect(rendered, `${code} leaked ${leaked}`).not.toContain(leaked);
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
      for (const code of APP_ERROR_CODES) {
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

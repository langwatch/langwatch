/**
 * @vitest-environment node
 *
 * scripts/check-openapi-completeness.ts.
 *
 * A gate is only worth its CI minutes if it still fails on the thing it was
 * written to catch, so every rule is pinned by a synthetic document that is
 * missing exactly one piece, and by the matching complete document that must
 * stay silent.
 *
 * The suppression lists get the same treatment from both directions: an entry
 * has to actually excuse its violation, and an entry that has stopped
 * excusing anything has to come back as stale. Without the second half a
 * fixed endpoint keeps its excuse forever and the list stops describing the
 * codebase.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applySuppressions,
  auditSpec,
  collectQueryReadingOperations,
  EXEMPTIONS,
  gatedBasePathOf,
  isEntryModule,
  KNOWN_GAPS,
  type Suppression,
  type Violation,
} from "../check-openapi-completeness";

const NO_QUERY_HANDLERS = new Set<string>();

const okResponses = {
  200: {
    description: "ok",
    content: { "application/json": { schema: { type: "object" } } },
  },
};

const jsonBody = {
  content: { "application/json": { schema: { type: "object" } } },
};

/**
 * Every operation declares its own security, because the fixtures below are
 * each about one other rule. The security rule has its own block.
 */
const secured = { security: [{ project_api_key: [] }] } as const;

function rules(violations: Violation[]): string[] {
  return violations.map((v) => `${v.operation} [${v.rule}]`);
}

function report(
  violations: Violation[],
  lists?: { exemptions?: Suppression[]; knownGaps?: Suppression[] },
) {
  return applySuppressions(violations, {
    exemptions: lists?.exemptions ?? [],
    knownGaps: lists?.knownGaps ?? [],
  });
}

describe("auditSpec", () => {
  describe("given a fully described surface", () => {
    it("reports nothing", () => {
      const violations = auditSpec(
        {
          paths: {
            "/api/gateway/v1/things": {
              get: {
                ...secured,
                parameters: [{ in: "query", name: "limit" }],
                responses: okResponses,
              },
              post: {
                ...secured,
                requestBody: jsonBody,
                responses: okResponses,
              },
            },
          },
        },
        new Set(["GET /api/gateway/v1/things"]),
      );

      expect(violations).toEqual([]);
    });
  });

  describe("given a write with no request body", () => {
    it.each(["post", "patch", "put"] as const)("reports %s as incomplete", (method) => {
      const violations = auditSpec(
        {
          paths: {
            "/api/gateway/v1/things": {
              [method]: { ...secured, responses: okResponses },
            },
          },
        },
        NO_QUERY_HANDLERS,
      );

      expect(rules(violations)).toEqual([
        `${method.toUpperCase()} /api/gateway/v1/things [request-body]`,
      ]);
    });

    it("leaves reads alone, because GET and DELETE carry no body", () => {
      const violations = auditSpec(
        {
          paths: {
            "/api/gateway/v1/things": {
              get: { ...secured, responses: okResponses },
            },
            "/api/gateway/v1/things/{id}": {
              delete: { ...secured, responses: okResponses },
            },
          },
        },
        NO_QUERY_HANDLERS,
      );

      expect(violations).toEqual([]);
    });
  });

  describe("given a handler that reads the query string", () => {
    it("reports an operation that declares no query parameter", () => {
      const violations = auditSpec(
        {
          paths: {
            "/api/gateway/v1/things": {
              get: {
                ...secured,
                parameters: [{ in: "path", name: "id" }],
                responses: okResponses,
              },
            },
          },
        },
        new Set(["GET /api/gateway/v1/things"]),
      );

      expect(rules(violations)).toEqual([
        "GET /api/gateway/v1/things [query-parameters]",
      ]);
    });

    it("reports a route the document does not describe at all", () => {
      const violations = auditSpec(
        { paths: {} },
        new Set(["GET /api/gateway/v1/undocumented"]),
      );

      expect(rules(violations)).toEqual([
        "GET /api/gateway/v1/undocumented [query-parameters]",
      ]);
      expect(violations[0]?.detail).toContain("generateOpenAPISpec");
    });
  });

  describe("given an operation with no schema-bearing 2xx", () => {
    it("reports one that declares no responses at all", () => {
      const violations = auditSpec(
        { paths: { "/api/webhooks/v1/things": { get: { ...secured } } } },
        NO_QUERY_HANDLERS,
      );

      expect(rules(violations)).toEqual([
        "GET /api/webhooks/v1/things [response-schema]",
      ]);
      expect(violations[0]?.detail).toContain("none at all");
    });

    it("reports one whose only 2xx has no schema", () => {
      const violations = auditSpec(
        {
          paths: {
            "/api/webhooks/v1/things": {
              get: {
                ...secured,
                responses: { 200: { content: {} }, 500: {} },
              },
            },
          },
        },
        NO_QUERY_HANDLERS,
      );

      expect(rules(violations)).toEqual([
        "GET /api/webhooks/v1/things [response-schema]",
      ]);
      expect(violations[0]?.detail).toContain("200, 500");
    });

    it("accepts a 201, because a create does not answer 200", () => {
      const violations = auditSpec(
        {
          paths: {
            "/api/gateway/v1/things": {
              post: {
                ...secured,
                requestBody: jsonBody,
                responses: {
                  201: {
                    content: { "application/json": { schema: {} } },
                  },
                },
              },
            },
          },
        },
        NO_QUERY_HANDLERS,
      );

      expect(violations).toEqual([]);
    });
  });

  describe("given an operation that declares no security of its own", () => {
    it("reports it, because the document default answers for it instead", () => {
      const violations = auditSpec(
        {
          paths: {
            "/api/gateway/v1/things": { get: { responses: okResponses } },
          },
        },
        NO_QUERY_HANDLERS,
      );

      expect(rules(violations)).toEqual(["GET /api/gateway/v1/things [security]"]);
    });

    it("accepts an empty requirement, which is a real answer", () => {
      // "No credential an integrator can send" is what a public or
      // internally-authenticated route publishes, and it has to be
      // distinguishable from having said nothing.
      const violations = auditSpec(
        {
          paths: {
            "/api/gateway/v1/things": {
              get: { security: [], responses: okResponses },
            },
          },
        },
        NO_QUERY_HANDLERS,
      );

      expect(violations).toEqual([]);
    });
  });

  describe("given paths outside the gated prefixes", () => {
    it("ignores them, however incomplete", () => {
      const violations = auditSpec(
        { paths: { "/api/traces": { post: {} } } },
        NO_QUERY_HANDLERS,
      );

      expect(violations).toEqual([]);
    });
  });
});

describe("applySuppressions", () => {
  const violation: Violation = {
    operation: "POST /api/gateway/v1/things/{id}/rotate",
    rule: "request-body",
    detail: "no requestBody",
  };

  describe("given an exemption for the violation", () => {
    it("suppresses it and reports no staleness", () => {
      const result = report([violation], {
        exemptions: [
          {
            operation: violation.operation,
            rules: ["request-body"],
            why: "rotation takes no input",
          },
        ],
      });

      expect(result.reported).toEqual([]);
      expect(result.stale).toEqual([]);
    });

    it("suppresses only the rule it names", () => {
      const result = report([violation, { ...violation, rule: "response-schema" }], {
        exemptions: [
          {
            operation: violation.operation,
            rules: ["request-body"],
            why: "rotation takes no input",
          },
        ],
      });

      expect(rules(result.reported)).toEqual([
        `${violation.operation} [response-schema]`,
      ]);
    });
  });

  describe("given a known gap for the violation", () => {
    it("suppresses it the same way an exemption does", () => {
      const result = report([violation], {
        knownGaps: [
          {
            operation: violation.operation,
            rules: ["request-body"],
            why: "debt",
          },
        ],
      });

      expect(result.reported).toEqual([]);
      expect(result.stale).toEqual([]);
    });
  });

  describe("given an entry that suppresses nothing", () => {
    it("reports it as stale so the list cannot outlive its reason", () => {
      const result = report([], {
        knownGaps: [
          {
            operation: "GET /api/webhooks/v1/fixed",
            rules: ["response-schema"],
            why: "was missing a response",
          },
        ],
      });

      expect(result.stale).toEqual([
        {
          list: "KNOWN_GAPS",
          operation: "GET /api/webhooks/v1/fixed",
          rule: "response-schema",
          why: "was missing a response",
        },
      ]);
    });

    it("names the list the entry came from", () => {
      const result = report([], {
        exemptions: [
          {
            operation: "GET /api/gateway/v1/gone",
            rules: ["response-schema"],
            why: "tombstone",
          },
        ],
      });

      expect(result.stale[0]?.list).toBe("EXEMPTIONS");
    });
  });
});

describe("the shipped suppression lists", () => {
  it("spells every operation the way the document does", () => {
    for (const entry of [...EXEMPTIONS, ...KNOWN_GAPS]) {
      expect(entry.operation).toMatch(
        /^(GET|POST|PUT|PATCH|DELETE) \/api\/(gateway|webhooks)\/v1\//,
      );
    }
  });

  it("gives a reason for every entry", () => {
    for (const entry of [...EXEMPTIONS, ...KNOWN_GAPS]) {
      expect(entry.why.length).toBeGreaterThan(0);
      expect(entry.rules.length).toBeGreaterThan(0);
    }
  });

  it("excuses an operation once, so the two lists cannot disagree", () => {
    const keys = [...EXEMPTIONS, ...KNOWN_GAPS].flatMap((entry) =>
      entry.rules.map((rule) => `${entry.operation} ${rule}`),
    );

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("gatedBasePathOf", () => {
  it("returns null for a file on another surface", () => {
    expect(gatedBasePathOf('basePath: "/api/traces"', "traces.ts")).toBeNull();
  });

  it("refuses a file that declares two gated basePaths", () => {
    expect(() =>
      gatedBasePathOf(
        'basePath: "/api/gateway/v1"\nbasePath: "/api/webhooks/v1"',
        "both.ts",
      ),
    ).toThrow(/more than one gated basePath/);
  });
});

describe("collectQueryReadingOperations", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "openapi-completeness-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(relative: string, source: string): void {
    const full = join(root, relative);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, source, "utf8");
  }

  it("keys a query-reading route by its templated document path", () => {
    write(
      "app.ts",
      [
        'const secured = createOrgApp({ basePath: "/api/webhooks/v1" });',
        'secured.get("/endpoints/:id/deliveries", zValidator("query", q), h);',
        'secured.get("/endpoints/:id", h);',
      ].join("\n"),
    );

    expect([...collectQueryReadingOperations([root])]).toEqual([
      "GET /api/webhooks/v1/endpoints/{id}/deliveries",
    ]);
  });

  it("skips files on surfaces this gate does not cover", () => {
    write(
      "other.ts",
      [
        'const secured = createProjectApp({ basePath: "/api/traces" });',
        'secured.get("/search", zValidator("query", q), h);',
      ].join("\n"),
    );

    expect([...collectQueryReadingOperations([root])]).toEqual([]);
  });

  it("skips test files, whose fixtures are not the running surface", () => {
    write(
      "__tests__/app.integration.test.ts",
      [
        'const secured = createOrgApp({ basePath: "/api/webhooks/v1" });',
        'secured.get("/fixture", zValidator("query", q), h);',
      ].join("\n"),
    );

    expect([...collectQueryReadingOperations([root])]).toEqual([]);
  });
});

describe("isEntryModule", () => {
  it("matches a module invoked through a path that resolves to it", () => {
    expect(
      isEntryModule({
        invokedPath: "./scripts/../scripts",
        modulePath: "scripts",
      }),
    ).toBe(true);
  });

  it("declines when nothing was invoked", () => {
    expect(isEntryModule({ invokedPath: undefined, modulePath: "scripts" })).toBe(false);
  });
});

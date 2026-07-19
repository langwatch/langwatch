import { describe, expect, it } from "vitest";
// The Explorer's REAL parser. The whole value of the deep link rests on the
// claim "what we put in `q` means, to the Explorer, what `--query` meant to the
// CLI" — so the test asks the Explorer itself rather than taking our word for it.
import { parse } from "~/server/app-layer/traces/query-language/parse";
import {
  asFreeTextTerm,
  buildTraceExplorerHref,
  parseTraceSearchCommand,
  readTraceSearchQuery,
} from "../logic/traceExplorerLink";

/** The fragment's `?…` half, which is where the Explorer keeps its query. */
function fragmentParams(href: string): URLSearchParams {
  const fragment = href.slice(href.indexOf("#") + 1);
  return new URLSearchParams(fragment.slice(fragment.indexOf("?") + 1));
}

function searchParams(href: string): URLSearchParams {
  const search = href.slice(href.indexOf("?") + 1, href.indexOf("#"));
  return new URLSearchParams(search);
}

describe("parseTraceSearchCommand", () => {
  describe("given the shell command the agent actually ran", () => {
    describe("when it carries a query and a date range", () => {
      it("recovers every flag the Explorer can use", () => {
        const search = parseTraceSearchCommand(
          "langwatch trace search --query 'checkout failed' --start-date 1750000000000 --end-date 1750086400000 --limit 25 --format json",
        );

        expect(search).toEqual({
          query: "checkout failed",
          startDate: 1750000000000,
          endDate: 1750086400000,
          limit: 25,
        });
      });
    });

    describe("when the query is quoted and contains spaces", () => {
      it("keeps it as one value instead of splitting it into stray tokens", () => {
        expect(
          parseTraceSearchCommand(
            'langwatch trace search -q "payment gateway timeout"',
          ).query,
        ).toBe("payment gateway timeout");
      });
    });

    describe("when flags are written as --flag=value", () => {
      it("reads the inline value", () => {
        expect(
          parseTraceSearchCommand(
            "langwatch trace search --query=refund --limit=5",
          ),
        ).toEqual({ query: "refund", limit: 5 });
      });
    });

    describe("when the dates are ISO strings", () => {
      it("normalizes them to epoch ms, which is what the Explorer's URL speaks", () => {
        const search = parseTraceSearchCommand(
          "langwatch trace search --start-date 2026-07-01T00:00:00Z --end-date 2026-07-02T00:00:00Z",
        );

        expect(search.startDate).toBe(Date.parse("2026-07-01T00:00:00Z"));
        expect(search.endDate).toBe(Date.parse("2026-07-02T00:00:00Z"));
      });
    });

    describe("when the search had no flags at all", () => {
      it("recovers nothing rather than inventing a query", () => {
        expect(parseTraceSearchCommand("langwatch trace search")).toEqual({});
      });
    });
  });
});

describe("readTraceSearchQuery", () => {
  describe("given the CLI envelope's tool input", () => {
    describe("when it is opencode's raw shell payload", () => {
      it("reads the flags out of the command string", () => {
        expect(
          readTraceSearchQuery({
            command: "langwatch trace search -q errors --limit 3",
          }),
        ).toEqual({ query: "errors", limit: 3 });
      });
    });

    describe("when it is a structured input", () => {
      it("reads the fields directly", () => {
        expect(
          readTraceSearchQuery({
            query: "errors",
            startDate: 1750000000000,
            endDate: 1750086400000,
          }),
        ).toEqual({
          query: "errors",
          startDate: 1750000000000,
          endDate: 1750086400000,
        });
      });
    });
  });
});

describe("asFreeTextTerm", () => {
  describe("given the CLI's free-text query", () => {
    describe("when it is turned into the Explorer's `q`", () => {
      it("parses back as free text, not as a field filter", () => {
        // This is the load-bearing claim. `status:error` was FREE TEXT to the
        // CLI. If it reached the Explorer unquoted, liqe would read it as a
        // field filter on `status`, and the user would land on a different
        // result set than the card showed them.
        const ast = parse(asFreeTextTerm("status:error"));

        expect(ast.type).toBe("Tag");
        const tag = ast as unknown as {
          field: { type: string };
          expression: { value: unknown };
        };
        expect(tag.field.type).toBe("ImplicitField");
        expect(tag.expression.value).toBe("status:error");
      });

      it("survives a plain multi-word query", () => {
        const ast = parse(asFreeTextTerm("checkout failed"));

        const tag = ast as unknown as {
          field: { type: string };
          expression: { value: unknown };
        };
        expect(tag.field.type).toBe("ImplicitField");
        expect(tag.expression.value).toBe("checkout failed");
      });
    });
  });
});

describe("buildTraceExplorerHref", () => {
  const search = {
    query: "checkout failed",
    startDate: 1750000000000,
    endDate: 1750086400000,
    limit: 25,
  };

  describe("given the search the agent ran", () => {
    describe("when the user follows the card through to the Explorer", () => {
      it("lands on the Trace Explorer, not the legacy messages page", () => {
        const href = buildTraceExplorerHref({ projectSlug: "acme", search })!;

        expect(href.startsWith("/acme/traces")).toBe(true);
      });

      it("carries the query and the exact window in the fragment", () => {
        const params = fragmentParams(
          buildTraceExplorerHref({ projectSlug: "acme", search })!,
        );

        expect(params.get("q")).toBe('"checkout failed"');
        expect(params.get("from")).toBe("1750000000000");
        expect(params.get("to")).toBe("1750086400000");
      });

      it("opens on the default lens, so no saved view narrows the result further", () => {
        const href = buildTraceExplorerHref({ projectSlug: "acme", search })!;

        expect(href).toContain("#all-traces?");
      });

      it("carries the window as absolute times, never a rolling preset", () => {
        // A preset ("24h") re-computes against `now` on arrival — a link opened
        // ten minutes later would query a different window than the agent did.
        const params = fragmentParams(
          buildTraceExplorerHref({ projectSlug: "acme", search })!,
        );

        expect(params.get("preset")).toBeNull();
      });
    });

    describe("when only part of the window is known", () => {
      it("omits the range rather than half-applying it", () => {
        const params = fragmentParams(
          buildTraceExplorerHref({
            projectSlug: "acme",
            search: { query: "x", startDate: 1750000000000 },
          })!,
        );

        expect(params.get("from")).toBeNull();
        expect(params.get("to")).toBeNull();
      });
    });

    describe("when the agent ran no query at all", () => {
      it("links to the plain explorer without inventing a filter", () => {
        expect(
          buildTraceExplorerHref({ projectSlug: "acme", search: {} }),
        ).toBe("/acme/traces#all-traces");
      });
    });
  });

  describe("given a single trace row on the card", () => {
    describe("when the user clicks it", () => {
      it("opens the same URL-routed drawer the trace table opens", () => {
        const params = searchParams(
          buildTraceExplorerHref({
            projectSlug: "acme",
            search,
            traceId: "trace_abc",
            traceTimestamp: 1750000000123,
          })!,
        );

        expect(params.get("drawer.open")).toBe("traceV2Details");
        expect(params.get("drawer.traceId")).toBe("trace_abc");
        expect(params.get("drawer.t")).toBe("1750000000123");
      });

      it("still carries the search, so closing the drawer leaves the right result set behind", () => {
        const href = buildTraceExplorerHref({
          projectSlug: "acme",
          search,
          traceId: "trace_abc",
        })!;

        expect(fragmentParams(href).get("q")).toBe('"checkout failed"');
      });
    });
  });

  describe("given no project slug", () => {
    describe("when a link is requested", () => {
      it("returns null so the caller hides the control instead of linking nowhere", () => {
        expect(
          buildTraceExplorerHref({ projectSlug: null, search }),
        ).toBeNull();
      });
    });
  });
});

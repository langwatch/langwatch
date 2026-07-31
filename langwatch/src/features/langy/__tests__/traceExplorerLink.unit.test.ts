import { describe, expect, it } from "vitest";
// The Explorer's REAL parser. The whole value of the deep link rests on the
// claim "what we put in `q` means, to the Explorer, what `--query` meant to the
// CLI" — so the test asks the Explorer itself rather than taking our word for it.
import { parse } from "~/server/app-layer/traces/query-language/parse";
import {
  asFreeTextTerm,
  buildAutomationHref,
  buildExplorerQuery,
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

    describe("when the agent nests one quoting level inside another", () => {
      // Observed live against the real agent: it wrote
      // `-q "\"override codes\""`, and reading `\"` as a closing quote
      // recovered `\override` — the phrase truncated at the space and a stray
      // backslash in the query. The Explorer then searched for something the
      // agent never searched for, which is the failure this module exists to
      // prevent.
      it("reads an escaped double quote as data, not as the end of the value", () => {
        expect(
          parseTraceSearchCommand(
            'langwatch trace search -q "\\"override codes\\"" --origin simulation',
          ),
        ).toEqual({ query: '"override codes"', origins: ["simulation"] });
      });

      it("keeps an escaped space inside an unquoted value", () => {
        expect(
          parseTraceSearchCommand(
            "langwatch trace search -q checkout\\ failed",
          ).query,
        ).toBe("checkout failed");
      });

      it("unescapes a doubled backslash inside double quotes", () => {
        expect(
          parseTraceSearchCommand(
            'langwatch trace search -q "a\\\\b"',
          ).query,
        ).toBe("a\\b");
      });

      it("leaves a backslash that escapes nothing the shell escapes alone", () => {
        // `sh` only treats \" \\ \$ \` as escapes inside double quotes; a
        // Windows-style path segment must survive intact rather than losing it.
        expect(
          parseTraceSearchCommand('langwatch trace search -q "C:\\path"').query,
        ).toBe("C:\\path");
      });

      it("treats a backslash inside single quotes as literal data", () => {
        expect(
          parseTraceSearchCommand("langwatch trace search -q 'a\\b'").query,
        ).toBe("a\\b");
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

    describe("when it carries an origin filter", () => {
      it("recovers a single origin", () => {
        expect(
          parseTraceSearchCommand("langwatch trace search --origin evaluation")
            .origins,
        ).toEqual(["evaluation"]);
      });

      it("splits a comma-separated list, the way the CLI itself splits it", () => {
        expect(
          parseTraceSearchCommand(
            "langwatch trace search --origin evaluation,simulation",
          ).origins,
        ).toEqual(["evaluation", "simulation"]);
      });

      it("trims whitespace around each value", () => {
        expect(
          parseTraceSearchCommand(
            "langwatch trace search --origin 'evaluation, simulation'",
          ).origins,
        ).toEqual(["evaluation", "simulation"]);
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

      it("reads a single origin as a one-item list", () => {
        expect(
          readTraceSearchQuery({ query: "errors", origin: "evaluation" }),
        ).toEqual({ query: "errors", origins: ["evaluation"] });
      });

      it("reads an already-structured list of origins", () => {
        expect(
          readTraceSearchQuery({ origins: ["evaluation", "simulation"] }),
        ).toEqual({ origins: ["evaluation", "simulation"] });
      });
    });
  });
});

describe("asFreeTextTerm", () => {
  describe("given the CLI's free-text query", () => {
    describe("when it is turned into the Explorer's `q`", () => {
      /** @scenario A search phrase that reads like a filter is still a phrase */
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

describe("buildExplorerQuery", () => {
  describe("given a search with only free text", () => {
    it("returns the quoted free-text term", () => {
      expect(buildExplorerQuery({ query: "checkout failed" })).toBe(
        '"checkout failed"',
      );
    });
  });

  describe("given a search narrowed to one origin", () => {
    /** @scenario A search narrowed to where the traces came from stays narrowed */
    it("adds an origin filter", () => {
      expect(buildExplorerQuery({ origins: ["evaluation"] })).toBe(
        "origin:evaluation",
      );
    });
  });

  describe("given a search narrowed to several origins", () => {
    /** @scenario A search narrowed to several origins keeps all of them */
    it("ORs them, so a trace from any one of them matches", () => {
      expect(
        buildExplorerQuery({ origins: ["evaluation", "simulation"] }),
      ).toBe("(origin:evaluation OR origin:simulation)");
    });

    it("parses as a real OR group, not two field filters ANDed together", () => {
      const ast = parse(
        buildExplorerQuery({ origins: ["evaluation", "simulation"] })!,
      ) as unknown as {
        type: string;
        expression: { type: string; operator: { operator: string } };
      };
      expect(ast.type).toBe("ParenthesizedExpression");
      expect(ast.expression.type).toBe("LogicalExpression");
      expect(ast.expression.operator.operator).toBe("OR");
    });
  });

  describe("given a search with both free text and an origin filter", () => {
    it("ANDs the origin filter onto the free text", () => {
      expect(
        buildExplorerQuery({ query: "timeout", origins: ["gateway"] }),
      ).toBe('"timeout" AND origin:gateway');
    });

    it("parses as an AND, so a trace must match both", () => {
      const ast = parse(
        buildExplorerQuery({ query: "timeout", origins: ["gateway"] })!,
      );
      expect(ast.type).toBe("LogicalExpression");
      const node = ast as unknown as { operator: { operator: string } };
      expect(node.operator.operator).toBe("AND");
    });
  });

  describe("given origins carrying surrounding whitespace", () => {
    it("trims them, so the facet value can actually match", () => {
      // Filtering on the trimmed value while quoting the untrimmed one emitted
      // `origin:" evaluation "` — padding included, matching nothing.
      expect(buildExplorerQuery({ origins: [" evaluation "] })).toBe(
        "origin:evaluation",
      );
    });

    it("drops whitespace-only entries instead of emitting an empty facet", () => {
      expect(
        buildExplorerQuery({ origins: ["  ", " simulation "] }),
      ).toBe("origin:simulation");
    });
  });

  describe("given an origin value the query language would otherwise misparse", () => {
    it("quotes it the way the Explorer's own filter sidebar quotes a facet value", () => {
      expect(buildExplorerQuery({ origins: ["my origin"] })).toBe(
        'origin:"my origin"',
      );
    });
  });

  describe("given a search that narrowed nothing", () => {
    it("returns null rather than an empty filter", () => {
      expect(buildExplorerQuery({})).toBeNull();
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

      /** @scenario A search over a stated period keeps that period */
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
      it("omits the absolute range rather than half-applying it", () => {
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

    describe("when the agent named no window at all", () => {
      // The CLI itself defaults to the last 24h rather than searching all
      // time (`cli/commands/traces/search.ts`), so a search that named no
      // window still covered one. This is the fix for the bug where the link
      // instead fell through to the Explorer's own 30d default — a search's
      // card would say "4 traces, no errors" while the Explorer, having
      // silently widened the window, showed a completely different set.
      /** @scenario A search that stated no period keeps the period it actually covered */
      it("carries the CLI's own default window as a rolling preset", () => {
        const params = fragmentParams(
          buildTraceExplorerHref({
            projectSlug: "acme",
            search: { query: "x" },
          })!,
        );

        expect(params.get("preset")).toBe("24h");
        expect(params.get("from")).toBeNull();
        expect(params.get("to")).toBeNull();
      });

      it("does the same even without a query, so a bare search isn't widened either", () => {
        const href = buildTraceExplorerHref({
          projectSlug: "acme",
          search: {},
        })!;

        expect(fragmentParams(href).get("preset")).toBe("24h");
        expect(fragmentParams(href).get("q")).toBeNull();
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

describe("buildAutomationHref", () => {
  const search = {
    query: "checkout failed",
    startDate: 1750000000000,
    endDate: 1750086400000,
  };

  describe("given the search the agent ran", () => {
    describe("when the user chooses to alert on it", () => {
      it("opens the automation drawer through the same URL params every drawer opens from", () => {
        const params = searchParams(
          buildAutomationHref({ projectSlug: "acme", search })!,
        );

        expect(params.get("drawer.open")).toBe("automation");
        expect(params.get("drawer.initialSource")).toBe("trace");
      });

      it("seeds the alert's subject with the search text, exactly as the Explorer's own Automate button would", () => {
        const params = searchParams(
          buildAutomationHref({ projectSlug: "acme", search })!,
        );

        expect(params.get("drawer.initialFilterQuery")).toBe(
          '"checkout failed"',
        );
      });

      it("keeps free text free text — the subject parses as an implicit term, never a field filter", () => {
        // The same load-bearing claim as `q` on the Explorer link, asked of
        // the REAL parser: what was free text to the CLI must stay free text
        // to the automation's matcher.
        const params = searchParams(
          buildAutomationHref({
            projectSlug: "acme",
            search: { query: "status:error" },
          })!,
        );

        const ast = parse(params.get("drawer.initialFilterQuery")!);
        const tag = ast as unknown as {
          field: { type: string };
          expression: { value: unknown };
        };
        expect(tag.field.type).toBe("ImplicitField");
        expect(tag.expression.value).toBe("status:error");
      });

      it("lands on the Explorer showing the very traces the alert would match", () => {
        const href = buildAutomationHref({ projectSlug: "acme", search })!;

        expect(href.startsWith("/acme/traces?")).toBe(true);
        expect(fragmentParams(href).get("q")).toBe('"checkout failed"');
        expect(fragmentParams(href).get("from")).toBe("1750000000000");
        expect(fragmentParams(href).get("to")).toBe("1750086400000");
      });
    });
  });

  describe("given a search narrowed only by origin, no free text", () => {
    describe("when a link is requested", () => {
      it("still has a subject to alert on", () => {
        const params = searchParams(
          buildAutomationHref({
            projectSlug: "acme",
            search: { origins: ["evaluation"] },
          })!,
        );

        expect(params.get("drawer.initialFilterQuery")).toBe(
          "origin:evaluation",
        );
      });
    });
  });

  describe("given a search with no text", () => {
    describe("when a link is requested", () => {
      it("returns null — a bare search has no subject to alert on", () => {
        expect(
          buildAutomationHref({ projectSlug: "acme", search: {} }),
        ).toBeNull();
        expect(
          buildAutomationHref({
            projectSlug: "acme",
            search: { query: "   " },
          }),
        ).toBeNull();
      });
    });
  });

  describe("given no project slug", () => {
    describe("when a link is requested", () => {
      it("returns null so the caller hides the control instead of linking nowhere", () => {
        expect(buildAutomationHref({ projectSlug: null, search })).toBeNull();
      });
    });
  });
});

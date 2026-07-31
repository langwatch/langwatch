import { describe, expect, it } from "vitest";
import { renderReportHtml } from "../render-report-html";
import { REPORT_SCRIPT } from "../report-script";
import {
  EVERY_BLOCK,
  makeCounts,
  makeEveryBlockModel,
  makeFiguresOnlyModel,
  makeMarkupModel,
  makeMarkupNameModel,
  makeModel,
  makeNothingSettledModel,
  makeSection,
  makeSmallSampleModel,
} from "./report-fixtures";

/** The document's single script, or null when there is not exactly one. */
function soleScriptBody(html: string): string | null {
  const matches = [
    ...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
  ];
  return matches.length === 1 ? (matches[0]?.[1] ?? null) : null;
}

function urlAttributes(html: string): string[] {
  return [...html.matchAll(/(?:src|href)\s*=\s*"([^"]*)"/g)].map(
    (match) => match[1] ?? "",
  );
}

function headlineRate(html: string): string {
  return /<p class="headline-rate">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
}

describe("Feature: Run report — the file itself", () => {
  describe("given any report", () => {
    const html = renderReportHtml({ model: makeModel() });

    /** @scenario The report opens with no network access */
    it("renders one document with its style and script inlined", () => {
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("<style>");
      expect(html).toContain("<script>");
    });

    /** @scenario The report opens with no network access */
    it("references nothing over the network", () => {
      for (const url of urlAttributes(html)) {
        expect(url).not.toMatch(/^https?:/);
        expect(url).not.toContain("//");
      }
      expect(html).not.toContain("http://");
      expect(html).not.toContain("https://");
    });

    /** @scenario The report says how it was produced */
    it("states which half was computed and which was written", () => {
      expect(html).toContain("How this report was produced");
      expect(html).toContain("The figures are computed");
      expect(html).toContain("traced back to the run");
    });

    /** @scenario Printing the report produces a clean document */
    it("carries print rules and marks the on-screen controls unprintable", () => {
      expect(html).toContain("@media print");
      expect(html).toContain('class="controls no-print"');
      expect(html).toContain(".no-print { display: none !important; }");
    });
  });
});

describe("Feature: Run report — model output is text", () => {
  describe("when the analysis contains markup", () => {
    const html = renderReportHtml({ model: makeMarkupModel() });

    /** @scenario Text from the analysis is shown as text */
    it("shows the statement as text rather than as part of the page", () => {
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    });

    /** @scenario Text from the analysis is shown as text */
    it("renders an artifact body in a code block with its markup escaped", () => {
      expect(html).toContain("<pre><code>");
      expect(html).toContain("&lt;/script&gt;&lt;script&gt;alert(1)");
    });

    /** @scenario Text from the analysis is shown as text */
    it("still contains exactly one script, and it is the report's own", () => {
      expect(soleScriptBody(html)).toBe(REPORT_SCRIPT);
    });
  });

  describe("when a scenario is named like markup", () => {
    const name = '<svg onload="alert(1)">';
    const html = renderReportHtml({ model: makeMarkupNameModel(name) });

    /** @scenario A scenario named like markup is shown as text */
    it("shows the name as text wherever it appears", () => {
      expect(html).not.toContain("<svg onload");
      expect(html).toContain("&lt;svg onload=&quot;alert(1)&quot;&gt;");
    });

    /** @scenario A scenario named like markup is shown as text */
    it("leaves the document with one script it did not author", () => {
      expect(soleScriptBody(html)).toBe(REPORT_SCRIPT);
    });
  });
});

describe("Feature: Run report — reading it", () => {
  describe("when failure detail is present", () => {
    const html = renderReportHtml({ model: makeEveryBlockModel() });

    /** @scenario Failure detail is hidden until I ask for it */
    it("puts each group behind a disclosure that starts closed", () => {
      expect(html).toContain("<details");
      expect(html).toContain("<summary>Agent skipped the confirmation step");
      expect(html).not.toContain("<details open");
    });

    /** @scenario Failure detail is hidden until I ask for it */
    it("offers on-screen-only controls for opening every disclosure", () => {
      expect(html).toContain('data-details="expand"');
      expect(html).toContain('data-details="collapse"');
    });

    /** @scenario The same run produces the same report twice */
    it("marks the header sortable and puts the sort key on the cell", () => {
      expect(html).toContain('<th scope="col" data-sortable aria-sort="none">');
      expect(html).toContain('data-sort-value="1200"');
    });
  });
});

describe("Feature: Run report — determinism", () => {
  describe("when the same model is rendered twice", () => {
    /** @scenario The same run produces the same report twice */
    it("produces byte-identical documents", () => {
      const model = makeModel({
        sections: [
          makeSection({ computed: EVERY_BLOCK, written: EVERY_BLOCK }),
        ],
      });
      expect(renderReportHtml({ model })).toBe(renderReportHtml({ model }));
    });

    /** @scenario The same run produces the same report twice */
    it("takes its timestamp from the model rather than the clock", () => {
      expect(renderReportHtml({ model: makeModel() })).toContain(
        "Generated 2026-07-29 10:00 UTC",
      );
    });
  });
});

describe("Feature: Run report — what survived being produced", () => {
  describe("when no model is configured for the report", () => {
    const html = renderReportHtml({ model: makeFiguresOnlyModel() });

    /** @scenario A report still downloads when no model is configured */
    it("states that the written analysis is unavailable", () => {
      expect(html).toContain("Langy could not write the analysis");
      expect(html).toContain("Figures only");
    });

    /** @scenario A report still downloads when no model is configured */
    it("still renders every section's computed figures", () => {
      expect(html).toContain("What failed?");
      expect(html).toContain("What holds?");
      expect(html).toContain("Agent skipped the confirmation step");
      expect(html).toContain("Refunds held.");
    });

    /** @scenario A report whose analysis failed still says so */
    it("names it as a failure, because the analysis was asked for", () => {
      expect(html).toContain("Langy could not write the analysis");
      expect(html).not.toContain("Exported without Langy");
    });
  });

  /**
   * The same tier is reached two ways, and the reader acts differently on each:
   * told a failure happened when none did, they go looking for a fault; told
   * nothing when one did, they read a thinner report than they asked for.
   */
  describe("when the analysis was never asked for", () => {
    const html = renderReportHtml({
      model: {
        ...makeFiguresOnlyModel(),
        meta: { ...makeFiguresOnlyModel().meta, withAnalysis: false },
      },
    });

    /** @scenario A report exported without the analysis does not read as a failure */
    it("says it was exported without the analysis rather than that it failed", () => {
      expect(html).toContain("Exported without Langy");
      expect(html).not.toContain("Langy could not write the analysis");
    });

    /** @scenario I can take the figures without waiting for the analysis */
    it("still carries every computed figure", () => {
      expect(html).toContain("Agent skipped the confirmation step");
      expect(html).toContain("Refunds held.");
    });

    /**
     * "0 statements removed" reads as "Langy wrote this and none of it was
     * cut" — the opposite of what happened when she was never called.
     */
    /** @scenario A report exported without the analysis does not read as a failure */
    it("does not account for a sieve that never ran", () => {
      expect(html).not.toContain("statements removed");
      expect(html).toContain("Nothing in this file was written by Langy");
    });
  });

  describe("when the second reading could not be completed", () => {
    /** @scenario A report still downloads when the check fails */
    it("states that the analysis could not be independently checked", () => {
      const html = renderReportHtml({
        model: makeModel({ tier: "unchecked" }),
      });
      expect(html).toContain("could not be checked a second time");
    });
  });
});

describe("Feature: Run report — gaps and integrity", () => {
  describe("when a question has nothing left to say", () => {
    /** @scenario A question left with nothing to say is shown as a gap */
    it("renders the question and says why it cannot be answered", () => {
      const html = renderReportHtml({
        model: makeModel({
          sections: [
            makeSection({
              question: "What should I do next?",
              gap: "There is not enough evidence to answer this.",
              written: [],
            }),
          ],
        }),
      });

      expect(html).toContain("What should I do next?");
      expect(html).toContain(
        '<p class="gap">There is not enough evidence to answer this.</p>',
      );
    });
  });

  describe("when statements were removed on the way here", () => {
    /** @scenario Removed statements are counted rather than hidden */
    it("counts each reason a statement went, and repeats the notes", () => {
      const html = renderReportHtml({
        model: makeModel({
          integrity: {
            claimsDroppedUncited: 2,
            claimsDroppedUnresolvable: 1,
            claimsDroppedUnconfirmed: 3,
            notes: ["The second reading covered 4 of 7 failure groups."],
          },
        }),
      });

      expect(html).toContain("2 statements removed for citing nothing");
      expect(html).toContain("1 statements removed for citing something");
      expect(html).toContain("3 statements removed because the second reading");
      expect(html).toContain("covered 4 of 7 failure groups.");
    });
  });
});

describe("Feature: Run report — the headline", () => {
  describe("when the sample is too small to conclude from", () => {
    const rate = headlineRate(
      renderReportHtml({ model: makeSmallSampleModel() }),
    );

    /** @scenario A small sample is reported as a small sample */
    it("says how many failed out of how many", () => {
      expect(rate).toContain("3 of 4 settled runs failed");
    });

    /** @scenario A small sample is reported as a small sample */
    it("says there were too few runs to draw a conclusion", () => {
      expect(rate).toContain("Too few runs to draw a conclusion");
    });

    /** @scenario A small sample is reported as a small sample */
    it("does not state a failure percentage on its own", () => {
      expect(rate).not.toContain("%");
    });
  });

  describe("when the sample is large enough", () => {
    /** @scenario A large enough sample states its rate with a margin */
    it("states the rate and the range it likely sits in", () => {
      const rate = headlineRate(renderReportHtml({ model: makeModel() }));
      expect(rate).toContain("Pass rate 80.0%");
      expect(rate).toContain("likely between 49.0% and 94.0%");
    });
  });

  describe("when there were plenty of runs but they varied widely", () => {
    const rate = headlineRate(
      renderReportHtml({
        model: makeModel({
          headline: {
            passRate: {
              value: 47.6,
              ci95: { low: 28.3, high: 67.6 },
              settled: 21,
              tooFewToConclude: true,
              inconclusiveReason: "spread_too_wide",
            },
            counts: makeCounts({
              passedCount: 10,
              failedCount: 11,
              completedCount: 21,
              settledCount: 21,
              totalCount: 21,
            }),
          },
        }),
      }),
    );

    /** @scenario A small sample is reported as a small sample */
    it("does not call twenty-one runs too few", () => {
      expect(rate).not.toContain("Too few runs");
      expect(rate).toContain("21 settled runs");
    });

    /** @scenario A small sample is reported as a small sample */
    it("names the inconsistency and the range it could sit in", () => {
      expect(rate).toContain("varied too much");
      expect(rate).toContain("28.3%");
      expect(rate).toContain("67.6%");
    });
  });

  describe("when nothing has settled yet", () => {
    /** @scenario A run still in progress reports only what has finished */
    it("says there is no pass rate rather than showing a zero", () => {
      const rate = headlineRate(
        renderReportHtml({ model: makeNothingSettledModel() }),
      );
      expect(rate).toContain("no pass rate to state");
    });
  });
});

describe("Feature: Run report — every block variant", () => {
  describe("when a section carries one of each", () => {
    const html = renderReportHtml({ model: makeEveryBlockModel() });

    /** @scenario Every question the report asks appears in it */
    it("renders each variant without throwing", () => {
      expect(html).toContain('<dl class="stats">');
      expect(html).toContain('<svg class="chart outcome-bar"');
      expect(html).toContain('<div class="table-wrap">');
      expect(html).toContain('<ul class="list">');
      expect(html).toContain("<details");
      expect(html).toContain('<p class="note');
      expect(html).toContain('<ul class="claims">');
      expect(html).toContain('<article class="finding">');
      expect(html).toContain('<article class="artifact">');
    });

    /** @scenario The report names the turn where a conversation went wrong */
    it("spells out every citation kind behind a claim", () => {
      expect(html).toContain("<li>run run-1</li>");
      expect(html).toContain("<li>criterion crit-1</li>");
      expect(html).toContain("<li>failure group sig-1</li>");
      expect(html).toContain("<li>run run-1, turn 4</li>");
      expect(html).toContain("<li>figure counts.failedCount</li>");
    });

    /** @scenario The most consequential failure is the first one I read */
    it("shows the computed severity beside one the analysis disagreed with", () => {
      expect(html).toContain("critical (computed: high)");
    });
  });
});

describe("Feature: Run report — the conversation behind a failure", () => {
  describe("when a failure group carries its conversations", () => {
    const html = renderReportHtml({ model: makeEveryBlockModel() });

    /** @scenario I can read the conversation behind a failure */
    it("puts the conversation inside the failure group it belongs to", () => {
      const group =
        /<details class="tone-fail">([\s\S]*?)<\/details>\s*<p class="note/.exec(
          html,
        )?.[1];

      expect(group).toContain('<details class="transcript">');
      expect(group).toContain("Apply my coupon.");
    });

    /** @scenario I can read the conversation behind a failure */
    it("labels each turn with who spoke and when", () => {
      expect(html).toContain('<span class="turn-role">user</span>');
      expect(html).toContain('<span class="turn-role">assistant</span>');
      expect(html).toContain('<span class="turn-index">turn 0</span>');
      expect(html).toContain('<span class="turn-index">turn 7</span>');
    });

    /**
     * The count comes from the gap between two kept turns, not from
     * `omittedTurns` — a marker that says "6" while sitting between turn 0 and
     * turn 7 would be describing a different conversation.
     *
     * @scenario A conversation with a dropped middle says where the gap is
     */
    it("marks the dropped middle between the turns either side of it", () => {
      expect(html).toContain(
        '<li class="turn-gap">6 turns not shown</li><li class="turn">',
      );
      expect(html).toMatch(
        /turn 0<\/span>[\s\S]*?turn-gap[\s\S]*?turn 7<\/span>/,
      );
    });
  });
});

describe("Feature: Run report — the three acts", () => {
  describe("when the questions span all three", () => {
    /** @scenario Questions are grouped into what happened, what is true now, and what to do next */
    it("groups the sections under their act in a fixed order", () => {
      const html = renderReportHtml({
        model: makeModel({
          sections: [
            makeSection({ questionId: "q3", tier: "future" }),
            makeSection({ questionId: "q1", tier: "past" }),
            makeSection({ questionId: "q2", tier: "present" }),
          ],
        }),
      });

      expect(html.indexOf("What happened")).toBeLessThan(
        html.indexOf("What is true now"),
      );
      expect(html.indexOf("What is true now")).toBeLessThan(
        html.indexOf("What to do next"),
      );
    });
  });
});

describe("Feature: Run report — conversation edge cases", () => {
  describe("when exactly one turn was dropped", () => {
    /** @scenario A conversation with a dropped middle says where the gap is */
    it("says turn rather than turns", () => {
      const html = renderReportHtml({
        model: makeModel({
          sections: [
            makeSection({
              computed: [
                {
                  kind: "groups",
                  groups: [
                    {
                      title: "Agent stalled",
                      subtitle: "1 scenario",
                      detail: [],
                      transcripts: [
                        {
                          runId: "run-9",
                          signatureId: "sig-9",
                          scenarioName: "Refund flow",
                          turns: [
                            { index: 0, role: "user", content: "Hello." },
                            { index: 2, role: "assistant", content: "Bye." },
                          ],
                          omittedTurns: 1,
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
          ],
        }),
      });

      expect(html).toContain("1 turn not shown");
      expect(html).not.toContain("1 turns not shown");
    });
  });
});

describe("Feature: Run report — a conversation that is not there", () => {
  describe("when a run ended before it exchanged a turn", () => {
    /** @scenario I can read the conversation behind a failure */
    it("says why the conversation is empty rather than showing nothing", () => {
      const html = renderReportHtml({
        model: makeModel({
          sections: [
            makeSection({
              computed: [
                {
                  kind: "groups",
                  groups: [
                    {
                      title: "Errored before it could be judged",
                      subtitle: "1 scenario",
                      detail: [],
                      transcripts: [
                        {
                          runId: "run-8",
                          signatureId: "sig-8",
                          scenarioName: "Cross-tenant access",
                          turns: [],
                          omittedTurns: 0,
                        },
                      ],
                    },
                  ],
                },
              ],
            }),
          ],
        }),
      });

      expect(html).toContain("No conversation was recorded");
      expect(html).not.toContain('<ol class="turns"></ol>');
    });
  });

  describe("when a group has no conversations kept", () => {
    /** @scenario I can read the conversation behind a failure */
    it("renders no replay section at all", () => {
      const html = renderReportHtml({
        model: makeModel({
          sections: [
            makeSection({
              computed: [
                {
                  kind: "groups",
                  groups: [
                    {
                      title: "Stopped reporting",
                      subtitle: "1 scenario",
                      detail: [{ label: "Scenarios", body: "Refund flow" }],
                    },
                  ],
                },
              ],
            }),
          ],
        }),
      });

      expect(html).toContain("Stopped reporting");
      expect(html).not.toContain('class="replay"');
      expect(html).not.toContain('class="transcript"');
    });
  });
});

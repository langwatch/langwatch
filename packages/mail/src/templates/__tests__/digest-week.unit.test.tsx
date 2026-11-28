import { describe, expect, it } from "vitest";

import {
  alsoThisWeek,
  buttonSlots,
  digestWeekPreview,
  digestWeekReason,
  digestWeekSubheading,
  digestWeekSubject,
  rowCopy,
  type RowCopy,
} from "../digest-week-rows.ts";
import { type DigestWeekProps, digestWeekProps, digestWeekTemplate } from "../digest-week.tsx";
import { renderMailTemplate } from "../registry.ts";

const fixture = (name: string): DigestWeekProps => {
  const found = digestWeekTemplate.fixtures.find((each) => each.name === name);
  if (!found) throw new Error(`fixture missing: ${name}`);
  return digestWeekProps.parse(found.props);
};

describe("the weekly digest's rows", () => {
  describe("given the thin organisation", () => {
    /** @scenario "A thin organization is asked to add an eval" */
    it("asks for an eval with a button, shows the traces, and offers a first scenario as a link", () => {
      const props = fixture("thin organisation, admin");
      const [setup, traces, tryThis] = props.rows.map(rowCopy);

      expect(setup).toMatchObject({
        title: "Nothing checked Docs helper's answers yet",
        button: { label: "Add an eval" },
        needsYou: true,
      });
      expect(traces?.title).toBe("Docs helper sent 37 traces, up from 12 last week");
      expect(tryThis).toMatchObject({ link: { label: "Write your first scenario" } });
      expect(tryThis?.button).toBeUndefined();
      expect(digestWeekSubheading(props)).toBe(
        "Nov 16 to 22 · Needs you: one eval on Docs helper.",
      );
    });
  });

  describe("given the moderate organisation", () => {
    /** @scenario "A moderate organization sees its regressions, a quiet project and its traces" */
    it("gives the scenario regression a button and the eval drop none, and names the steady eval", () => {
      const props = fixture("moderate organisation, member");
      const [scenarios, evals, quiet] = props.rows.map(rowCopy);

      expect(scenarios).toMatchObject({
        title: "Support agent's scenarios failed 19% of runs, up from 6%",
        button: { label: "See the failing runs" },
      });
      expect(evals?.title).toBe("Support agent's tone eval passed 81% of traces, down from 93%");
      expect(evals?.button).toBeUndefined();
      expect(quiet?.title).toBe("Order search sent no traces this week");
      expect(props.rows.map((row) => row.kind)).toEqual([
        "scenarios",
        "evals",
        "quiet",
        "traces",
        "new",
      ]);
      expect(alsoThisWeek(props).lead).toBe(
        "4,330 traces across 2 projects and faithfulness eval held steady at 96% passed.",
      );
    });
  });

  describe("given the flooded organisation", () => {
    /** @scenario "A flooded organization's admin sees the plan first and at most two buttons" */
    it("leads with the plan, a button to raise the limit and a link to choose what to keep", () => {
      const props = fixture("flooded organisation, admin");
      const copies = props.rows.map(rowCopy);

      expect(copies[0]).toMatchObject({
        title: "You have used 94% of this month's traces",
        button: { label: "Raise the limit" },
        link: { before: "or ", label: "choose which traces to keep" },
      });
      expect(props.rows).toHaveLength(5);
      expect(buttonSlots(copies).filter((slot) => slot !== null)).toHaveLength(2);
      expect(digestWeekSubject(props)).toBe("You have used 94% of this month's traces");
    });

    /** @scenario "Rows cut by the cap are named in the Also line, and a cut New row is dropped" */
    it("names the folded traces row in the Also line and the cut New row nowhere", async () => {
      const props = fixture("flooded organisation, admin");
      const also = alsoThisWeek(props);

      expect(also.folded.map((row) => row.label)).toEqual([
        "Checkout agent sent 412,800 traces, up from 378,700 last week",
      ]);
      expect(also.lead).toBe("659,750 traces across 5 projects and 2 evals held steady.");
      const { html } = await renderMailTemplate(digestWeekTemplate, props);
      expect(html).not.toContain("Test conversations before you ship");
      expect(html).not.toContain("first scenario");
    });

    /** @scenario "Only an admin near the plan limit sees the plan row, and first" */
    it("gives a member no plan row, and their own subject", () => {
      const props = fixture("flooded organisation, member");

      expect(props.rows.map((row) => row.kind)).not.toContain("plan");
      expect(digestWeekSubject(props)).toBe(
        "Checkout agent's scenarios failed 31% of runs, up from 9%",
      );
    });
  });

  describe("given more rows with buttons than the email holds", () => {
    /** @scenario "A flooded organization's admin sees the plan first and at most two buttons" */
    it("keeps the first two buttons, ink then outlined, and drops the rest", () => {
      const row = (button: boolean): RowCopy => ({
        kind: "plan",
        title: "",
        href: "",
        context: "",
        needsYou: button,
        previewPhrase: "",
        ...(button ? { button: { label: "Go", href: "" } } : {}),
      });

      expect(buttonSlots([row(true), row(true), row(false), row(true)])).toEqual([
        0,
        1,
        null,
        null,
      ]);
    });
  });

  describe("given a recovery", () => {
    /** @scenario "A recovery shows without a button" */
    it("reads the fall from its baseline and carries no button", () => {
      const [recovered] = fixture("recovery only").rows.map(rowCopy);

      expect(recovered?.title).toBe("Checkout agent's scenarios failed 4% of runs, down from 19%");
      expect(recovered?.button).toBeUndefined();
      expect(recovered?.needsYou).toBe(false);
    });
  });
});

describe("the coding-agent row", () => {
  const everyFixture = digestWeekTemplate.fixtures.map((each) => digestWeekProps.parse(each.props));

  /** @scenario "A coding-agent row never shows cost" */
  it("shows no cost in the row, the subject or the preview", () => {
    const withCoding = everyFixture.filter((props) =>
      props.rows.some((row) => row.kind === "coding"),
    );
    expect(withCoding.length).toBeGreaterThan(0);
    for (const props of withCoding) {
      const coding = props.rows.find((row) => row.kind === "coding");
      const copy = coding && rowCopy(coding);
      const words = [
        copy?.title,
        copy?.context,
        digestWeekSubject(props),
        digestWeekPreview(props),
      ];
      for (const text of words) {
        expect(text).not.toContain("$");
        expect(text).not.toMatch(/cost/i);
      }
    }
  });

  /** @scenario "A person's week past its series cap reads its totals as floors" */
  it("reads each total as at least what it kept when the series cap was hit", () => {
    const [capped] = fixture("coding totals past the series cap").rows.map(rowCopy);
    const [plain] = fixture("flooded organisation, admin")
      .rows.filter((row) => row.kind === "coding")
      .map(rowCopy);

    expect(capped?.context).toBe(
      "At least 41.2M tokens, 23 commits and 7 pull requests, 38 of the sessions in northwind/storefront.",
    );
    expect(plain?.context).not.toContain("at least");
  });
});

describe("every weekly digest fixture", () => {
  /** @scenario "The plan row and the subject never name the organization twice" */
  it("has a subject with no colon, so the send's organization prefix is its only one", () => {
    for (const { props } of digestWeekTemplate.fixtures) {
      expect(digestWeekSubject(digestWeekProps.parse(props))).not.toContain(":");
    }
  });

  /** @scenario "Every weekly digest says why it arrived, whatever the reader's role" */
  it("gives a role-neutral reason and keeps outlined chips and dividers dark in dark mode", async () => {
    for (const { props } of digestWeekTemplate.fixtures) {
      const { html } = await renderMailTemplate(digestWeekTemplate, props);

      expect(digestWeekReason(digestWeekProps.parse(props))).toMatch(/^You get this because you/);
      expect(html).toContain("turn off the weekly digest.");
      expect(html).toContain('class="lw-muted lw-rule"');
    }
    const { html } = await renderMailTemplate(
      digestWeekTemplate,
      fixture("flooded organisation, admin"),
    );
    expect(html).toContain("background-color:transparent");
    expect(html).not.toContain("background-color:#ffffff;color:#b7791f");
  });
});

import { describe, expect, it } from "vitest";

import { describeExpect, judgeCount } from "../flows/expect.ts";
import { fixturePath } from "../flows/interactions.ts";
import { firstLink, newest, summaries } from "../flows/mail.ts";
import { hasTarget, isTargeted } from "../flows/target.ts";
import { fillArgs, fillValues, uidFor } from "../flows/values.ts";
import { flowProject } from "../screens.ts";

const plan = {
  slug: "local-dev-project",
  credential: { email: "a@b.c", password: "p", projectKey: "sk-main", slug: "local-dev-project" },
};
const flow = { id: "f", title: "f", steps: [] };

describe("Feature: flows share one stack without colliding", () => {
  describe("given placeholders in a step's arguments", () => {
    /** @scenario Every flow suffixes what it creates with its own token */
    it("fills {uid}, a captured value and a fixture, and leaves other braces alone", () => {
      const values = { uid: uidFor("automation-alert"), shareUrl: "https://x/s/1" };
      expect(fillValues({ text: "VD Alert {uid}", values })).toBe(`VD Alert ${values.uid}`);
      expect(fillArgs({ args: { path: "{shareUrl}", note: "{other}" }, values })).toEqual({
        path: "https://x/s/1",
        note: "{other}",
      });
    });

    /** @scenario Every flow suffixes what it creates with its own token */
    it("gives each flow a token of its own that both sides agree on", () => {
      expect(uidFor("a")).not.toBe(uidFor("b"));
      expect(uidFor("a")).toBe(uidFor("a"));
      expect(uidFor("a")).toMatch(/^[0-9a-z]{8}$/);
    });
  });

  describe("given a flow that changes project settings", () => {
    /** @scenario A flow that changes project settings works in a project of its own */
    it("works in the isolated project when the seed made one", () => {
      const project = flowProject({
        plan,
        flow: { ...flow, isolated: true },
        fixtures: { isolatedSlug: "vd-isolated", isolatedProjectKey: "sk-iso" },
      });
      expect(project.slug).toBe("vd-isolated");
      expect(project.credential.projectKey).toBe("sk-iso");
      expect(project.missing).toBe("");
    });

    /** @scenario A flow that changes project settings works in a project of its own */
    it("says so instead of editing the main project when there is none", () => {
      const project = flowProject({ plan, flow: { ...flow, isolated: true }, fixtures: {} });
      expect(project.missing).toContain("isolated project");
    });

    /** @scenario A flow that changes project settings works in a project of its own */
    it("keeps every other flow in the main project", () => {
      expect(flowProject({ plan, flow, fixtures: {} })).toEqual({
        slug: plan.slug,
        credential: plan.credential,
        missing: "",
      });
    });
  });
});

describe("Feature: flows name elements by test id", () => {
  /** @scenario Steps target elements by test id, prefix or label */
  it("treats a test id, prefix or label as naming an element, and text as not", () => {
    expect(hasTarget({ testId: "x" })).toBe(true);
    expect(hasTarget({ testIdPrefix: "row-" })).toBe(true);
    expect(hasTarget({ label: "Close" })).toBe(true);
    expect(hasTarget({ text: "Close" })).toBe(false);
    expect(isTargeted({ selector: "select" })).toBe(true);
    expect(isTargeted({ selector: "button", text: "Save" })).toBe(false);
  });

  /** @scenario An expect on an element counts what is on screen */
  it("describes element and status expects the same on both sides", () => {
    expect(describeExpect({ testId: "trace-row", min: "3" })).toBe("testId trace-row >= 3");
    expect(describeExpect({ testIdPrefix: "row-", hasText: "VD" })).toBe(
      'testIdPrefix row- with text "VD" >= 1',
    );
    expect(describeExpect({ api: "/api/x", status: "401", auth: "none" })).toBe(
      "api /api/x status 401",
    );
    expect(describeExpect({ text: "Gone", equals: "0" })).toBe('text "Gone" == 0');
    expect(judgeCount({ found: 0, args: { equals: "0" } })).toBe("");
  });
});

describe("Feature: flows read mail and attach fixtures", () => {
  /** @scenario A mail step reads the newest matching message */
  it("picks the latest-received message and ignores what it cannot place in time", () => {
    const listed = summaries({
      messages: [
        { id: "old", receivedAt: "2026-09-29T10:00:00Z" },
        { id: "new", receivedAt: "2026-09-29T11:00:00Z" },
        { id: "broken" },
      ],
    });
    expect(listed.map((message) => message.id)).toEqual(["old", "new"]);
    expect(newest(listed)?.id).toBe("new");
    expect(newest([])).toBeUndefined();
    expect(summaries("nothing")).toEqual([]);
  });

  it("keeps the first page link, not the DOCTYPE or a logo", () => {
    const links = [
      "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd",
      "https://app.langwatch.ai/images/logo.png",
      "https://app.example.test/auth/reset-password?token=abc",
    ];
    expect(firstLink(links)).toBe("https://app.example.test/auth/reset-password?token=abc");
    expect(firstLink([links[0]])).toBeUndefined();
    expect(firstLink("nothing")).toBeUndefined();
  });

  /** @scenario An upload step attaches a file from the fixtures directory */
  it("resolves a bare fixture name and refuses one that climbs out", () => {
    expect(fixturePath("sample.csv")).toMatch(/tools\/visualdiff\/fixtures\/sample\.csv$/);
    expect(() => fixturePath("../seed.go")).toThrow("bare file name");
  });
});

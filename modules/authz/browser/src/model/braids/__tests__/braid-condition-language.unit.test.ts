/**
 * Spec: modules/authz/specs/braids-screen.feature,
 * "Autocomplete offers the owner's attribute keys".
 */
import { compileBraidCondition } from "@langwatch/authz-contract/braid-condition-compiler";
import { describe, expect, it } from "vitest";

import { braidConditionCompletions } from "../braid-condition-language.ts";

const KEYS = [
  { key: "team", spanCount: 3 },
  { key: "orchestrator", spanCount: 1200 },
];

const at = (text: string, offset = text.length) =>
  braidConditionCompletions({ text, offset, attributeKeys: KEYS });

describe("braidConditionCompletions", () => {
  describe('when the cursor is inside attributes["', () => {
    /** @scenario Autocomplete offers the owner's attribute keys */
    it("offers the owner's keys, most used first, with their span counts", () => {
      const { items } = at('attributes["');
      expect(items.map(({ label, detail }) => [label, detail])).toEqual([
        ["orchestrator", "1,200 spans"],
        ["team", "3 spans"],
      ]);
    });

    it("replaces the typed part and the closing quote and bracket", () => {
      const text = 'attributes["or"] == "web"';
      const offset = 'attributes["or'.length;
      const { items, replaceFrom, replaceTo } = at(text, offset);
      expect(text.slice(replaceFrom, replaceTo)).toBe('"or"]');
      expect(items[0]?.insertText).toBe('"orchestrator"]');
      expect(items[0]?.filterText).toBe('"orchestrator');
    });

    it("offers the keys between auto-closed quotes, replacing the quotes and the bracket", () => {
      const text = 'attributes[""]';
      const offset = 'attributes["'.length;
      const { items, replaceFrom, replaceTo } = at(text, offset);
      expect(items.map((item) => item.label)).toEqual(["orchestrator", "team"]);
      expect(text.slice(replaceFrom, replaceTo)).toBe('""]');
      expect(text.slice(replaceFrom, offset)).toBe('"');
      expect(items[0]?.filterText).toBe('"orchestrator');
    });

    it("quotes the key itself straight after the bracket", () => {
      const { items, replaceFrom, replaceTo } = at("attributes[]", "attributes[".length);
      expect([replaceFrom, replaceTo]).toEqual(["attributes[".length, "attributes[]".length]);
      expect(items[1]?.insertText).toBe('"team"]');
    });

    it("keeps the replaced range on the caret's line when the key runs past a line break", () => {
      const text = 'attributes["or\nchestrator"] == "web"';
      const offset = 'attributes["or'.length;
      const { items, replaceFrom, replaceTo } = at(text, offset);
      expect(items).toHaveLength(2);
      expect(text.slice(replaceFrom, replaceTo)).toBe('"or');
    });

    it("offers no keys on the line after a key broken by a line break", () => {
      const text = 'attributes["or\nch';
      expect(at(text).items.map((item) => item.label)).not.toContain("orchestrator");
    });

    it("escapes a key holding a quote", () => {
      const { items } = braidConditionCompletions({
        text: 'attributes["',
        offset: 12,
        attributeKeys: [{ key: 'a"b', spanCount: 1 }],
      });
      expect(items[0]).toMatchObject({ insertText: '"a\\"b"]', detail: "1 span" });
    });
  });

  describe("when the cursor is at the top level", () => {
    /** @scenario Autocomplete offers the owner's attribute keys */
    it("offers the paths, Verified, the comparisons and the words the compiler accepts", () => {
      const { items } = at('attributes["team"] == "a" ');
      expect(items.map((item) => item.label)).toEqual([
        'attributes[""]',
        'resource.attributes[""]',
        "name",
        'Verified("")',
        "==",
        "!=",
        "and",
        "nil",
      ]);
      expect(items[0]).toMatchObject({ insertText: 'attributes["$0"]', isSnippet: true });
    });

    it("offers nothing the compiler refuses: each item compiles in a minimal condition", () => {
      const conditionOf: Record<string, (inserted: string) => string> = {
        'attributes[""]': (inserted) => `${inserted} == "v"`,
        'resource.attributes[""]': (inserted) => `${inserted} == "v"`,
        name: (inserted) => `${inserted} == "v"`,
        'Verified("")': (inserted) => inserted,
        "==": (inserted) => `attributes["k"] ${inserted} "v"`,
        "!=": (inserted) => `attributes["k"] ${inserted} nil`,
        and: (inserted) => `name == "a" ${inserted} attributes["k"] == "v"`,
        nil: (inserted) => `attributes["k"] != ${inserted}`,
      };
      const { items } = at("");
      expect(items.map((item) => item.label).toSorted()).toEqual(
        Object.keys(conditionOf).toSorted(),
      );
      for (const item of items) {
        const text = conditionOf[item.label]!(item.insertText.replace("$0", "k"));
        expect({ text, result: compileBraidCondition({ text }) }).toMatchObject({
          result: { ok: true },
        });
      }
    });

    it("still offers the built-ins when the owner's keys could not be looked up", () => {
      const { items } = braidConditionCompletions({ text: "", offset: 0, attributeKeys: [] });
      expect(items.map((item) => item.label)).toEqual(
        expect.arrayContaining(['attributes[""]', 'Verified("")', "and", "nil"]),
      );
    });

    it("replaces the word being typed", () => {
      const { replaceFrom, replaceTo } = at('attributes["team"] == "a" an');
      expect([replaceFrom, replaceTo]).toEqual([26, 28]);
    });

    it("offers nothing inside another string", () => {
      expect(at('attributes["team"] == "we').items).toEqual([]);
    });
  });
});

/**
 * Spec: modules/authz/specs/braids-screen.feature,
 * "Autocomplete offers the owner's attribute keys".
 */
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
    it("offers attributes, Verified, the comparisons and the joining words", () => {
      const { items } = at('attributes["team"] == "a" ');
      expect(items.map((item) => item.label)).toEqual([
        'attributes[""]',
        'Verified("")',
        "==",
        "!=",
        "and",
        "or",
        "not",
        "true",
        "false",
      ]);
      expect(items[0]).toMatchObject({ insertText: 'attributes["$0"]', isSnippet: true });
    });

    it("still offers the built-ins when the owner's keys could not be looked up", () => {
      const { items } = braidConditionCompletions({ text: "", offset: 0, attributeKeys: [] });
      expect(items.map((item) => item.label)).toEqual(
        expect.arrayContaining(['attributes[""]', 'Verified("")', "and", "or", "not"]),
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

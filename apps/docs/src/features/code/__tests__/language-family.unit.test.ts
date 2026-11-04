import { describe, expect, it } from "vitest";

import { languageFamily, tabFamilies } from "../model/language-family.ts";

describe("languageFamily", () => {
  /** @scenario "Treat the spellings of one language as one choice" */
  it("treats TypeScript, JavaScript and Node as one language", () => {
    for (const label of ["TypeScript", "JavaScript", "TS", "js", "Node.js", "TypeScript SDK"])
      expect(languageFamily({ label })).toBe("typescript");
  });

  /** @scenario "Treat the spellings of one language as one choice" */
  it("groups Python spellings and shell commands", () => {
    for (const label of ["Python", "py", "Python (Notebook)", "OpenAI (Python)"])
      expect(languageFamily({ label })).toBe("python");
    for (const label of ["curl", "Bash", "Shell", "cURL"])
      expect(languageFamily({ label })).toBe("shell");
    expect(languageFamily({ label: "Go" })).toBe("go");
    expect(languageFamily({ label: "Java" })).toBe("java");
    expect(languageFamily({ label: "C#" })).toBe("csharp");
  });

  /** @scenario "Treat the spellings of one language as one choice" */
  it("ignores labels that name no language and file extensions", () => {
    for (const label of ["Environment Variable", "npm", "chat.py", "Next.js", "200", "Cloud"])
      expect(languageFamily({ label })).toBeNull();
  });
});

describe("tabFamilies", () => {
  /** @scenario "Treat the spellings of one language as one choice" */
  it("falls back from a filename label to the code's language", () => {
    expect(
      tabFamilies({
        tabs: [
          ["chat.py", "python"],
          ["chat.ts", "typescript"],
        ],
      }),
    ).toEqual(["python", "typescript"]);
  });

  /** @scenario "Treat the spellings of one language as one choice" */
  it("leaves a group out when it offers fewer than two languages", () => {
    expect(tabFamilies({ tabs: [["Python (Notebook)"], ["Environment Variable"]] })).toEqual([
      null,
      null,
    ]);
    expect(tabFamilies({ tabs: [["Python"], ["Python (async)"]] })).toEqual([null, null]);
  });
});

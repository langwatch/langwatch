// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * How far back a newly added scheduled source proposes to read, and the one
 * table that decides it per source type.
 *
 * A source added with no start date reads only the last few days, so the
 * Activity Monitor shows a flat line on the day an admin finishes setting it
 * up — the moment they are most likely to conclude the integration does not
 * work. The form therefore proposes a start instead of leaving the field
 * empty.
 *
 * The number differs per provider because the providers do: OpenAI serves four
 * years of daily spend, Anthropic considerably less. It is a proposal, not a
 * limit, so the figure is a product decision rather than an API one — a year
 * for OpenAI shows a year-on-year trend on day one without a first run that
 * reads four years of days, and six months of Anthropic is about six pages at
 * the adapter's daily bucket, well inside `MAX_PAGES_PER_RUN`.
 *
 * Declared in one table beside the cadence defaults so the proposal and any
 * copy describing it read the same source. The risk this file exists for is
 * the proposal leaking onto the edit form, where it would move a date that has
 * already been read from, on a drawer the admin opened to change a name.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOpenAiAdminPullConfig,
  type ComposerState,
  dateInputValue,
  defaultParserValues,
  fieldControl,
  PARSER_FIELDS,
  SOURCE_BACKFILL_MONTHS,
  seedComposerParserConfig,
} from "../inventory";

const fieldFor = (
  sourceType: "openai_admin" | "anthropic_admin",
  key: string,
) => {
  const field = PARSER_FIELDS[sourceType].find((f) => f.key === key);
  if (!field) throw new Error(`no ${sourceType} field named ${key}`);
  return field;
};

const openAiComposerWith = (
  parserConfig: Record<string, string>,
): ComposerState => ({
  sourceType: "openai_admin",
  name: "OpenAI org",
  description: "",
  parserConfig: { credentialsToken: "sk-admin-test", ...parserConfig },
  pullSchedule: "0 * * * *",
  ottlStatements: [],
  traceProjectId: null,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the date history is read from", () => {
  // @scenario "The field asks when to start reading, not for a backfill start"
  it("asks when to start reading, and keeps what only OpenAI can say", () => {
    const field = fieldFor("openai_admin", "startingAt");

    // "Backfill start (optional)" was our word for it plus a description of
    // the form rather than of the setting.
    expect(field.label).toBe("Read history from");
    expect(fieldControl({ field, values: {} }).kind).toBe("date");

    const hint = field.hint ?? "";
    expect(hint).toMatch(/first day/i);
    expect(hint).toMatch(/forward|where the last/i);
    expect(hint).toMatch(/clear/i);
    // The provider-specific caveat is not general plain-words copy and is the
    // one thing an admin picking a date a year back has to know here.
    expect(hint).toMatch(/December 2025/);
    expect(hint).toMatch(/API key/i);
  });

  // @scenario "A new OpenAI source proposes a year of history"
  it("proposes midnight UTC one year back for a new OpenAI source", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T10:30:00.000Z"));

    expect(defaultParserValues("openai_admin").startingAt).toBe(
      "2025-09-15T00:00:00.000Z",
    );
  });

  // @scenario "A new OpenAI source proposes a year of history"
  it("reads the figure from the one declared table, per source type", () => {
    // Two source types, two numbers, one place. A second copy of either
    // figure is how the proposal and the sentence describing it drift apart.
    expect(SOURCE_BACKFILL_MONTHS.openai_admin).toBe(12);
    expect(SOURCE_BACKFILL_MONTHS.anthropic_admin).toBe(6);
  });

  // @scenario "Editing an existing source shows what it holds"
  it("shows the stored day on an edit rather than proposing a new one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T10:30:00.000Z"));

    const seeded = seedComposerParserConfig({
      sourceType: "openai_admin",
      storedParserConfig: { startingAt: "2026-02-03T00:00:00.000Z" },
    });

    expect(seeded.startingAt).toBe("2026-02-03T00:00:00.000Z");
    expect(dateInputValue(seeded.startingAt ?? "")).toBe("2026-02-03");
  });

  // @scenario "Editing an existing source shows what it holds"
  it("leaves an edited source with no start date empty rather than proposing one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T10:30:00.000Z"));

    // A source saved before the field had a default, or one whose admin
    // deliberately cleared it. Seeding the proposal here would hand it a year
    // of history it was never configured to read.
    expect(
      seedComposerParserConfig({
        sourceType: "openai_admin",
        storedParserConfig: { model: "gpt-4o" },
      }),
    ).not.toHaveProperty("startingAt");
  });

  // @scenario "Clearing the proposal still means the adapter's own default"
  it("carries no start date once the admin clears the proposal", () => {
    const built = buildOpenAiAdminPullConfig(
      openAiComposerWith({ startingAt: "" }),
    );

    expect(built).not.toBeNull();
    expect(built).not.toHaveProperty("startingAt");
  });
});

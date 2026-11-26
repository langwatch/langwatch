/**
 * Langy writes widgets from the dashboard-widgets skill, so the skill carries the same
 * reader-zone bucket the templates use, and the label helper, in every copy it ships as.
 * @see modules/analytics/specs/dashboard-widget-time-zone.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { lwqlBucketStartSql } from "../analytics.lwql-time-window.ts";

const REPO = fileURLToPath(new URL("../../../../../../../", import.meta.url));
const COPIES = [
  "skills/recipes/dashboard-widgets/SKILL.mdx",
  "services/langyagent/internal/assets/skills/dashboard-widgets/SKILL.md",
];

describe.each(COPIES)("given the dashboard-widgets skill at %s", (copy) => {
  const skill = readFileSync(`${REPO}${copy}`, "utf8");

  /** @scenario "TZ13 Langy's widget skill buckets with the reader's zone and never hardcodes UTC" */
  it("shows the reader-zone bucket the dashboard templates use", () => {
    const bucket = lwqlBucketStartSql({
      column: "OccurredAt",
      granularity: "{dashboard_context_granularity_seconds:UInt32}",
      timeZone: "{dashboard_context_timezone:String}",
    });

    expect(skill).toContain(`${bucket} AS bucket`);
  });

  /** @scenario "TZ13 Langy's widget skill buckets with the reader's zone and never hardcodes UTC" */
  it("labels with LW.formatTime and says never to write UTC in a widget", () => {
    expect(skill).toContain("LW.formatTime(row.bucket)");
    expect(skill).toContain('Never write "UTC" in a widget');
    expect(skill).not.toMatch(/String\(row\.\w+\)\.slice\(0, 10\)/);
  });
});

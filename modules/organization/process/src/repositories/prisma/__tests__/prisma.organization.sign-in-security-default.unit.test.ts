/**
 * The Organization table's own default for the idle window: a day for rows written from now on.
 * Rows that existed before keep "no rule"; that is the migration's job, not this column's.
 * @see specs/identity/org-session-lifetime.feature
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const schema = readFileSync(
  new URL("../../../../../../../packages/prisma-client/prisma/schema.prisma", import.meta.url),
  "utf8",
);

function organizationColumn(name: string): string {
  const model = /^model Organization \{([\s\S]*?)^\}/m.exec(schema)?.[1] ?? "";
  return model.split("\n").find((line) => line.trim().startsWith(`${name} `)) ?? "";
}

describe("given the Organization table", () => {
  describe("when a row is written without naming the idle window", () => {
    /** @scenario "An organization made from now on starts with a day" */
    it("declares a day of minutes as the column's default", () => {
      expect(organizationColumn("sessionIdleTimeoutMinutes")).toMatch(/@default\(1440\)/);
    });
  });
});

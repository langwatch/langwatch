import { describe, expect, it } from "vitest";

import type { LwqlRowPolicy } from "../../repositories/langwatch-ql-provisioning.repository.ts";
import { unguardedTables } from "../lwql-private-policies.rules.ts";

const policy = (over: Partial<LwqlRowPolicy> & { table: string }): LwqlRowPolicy => ({
  appliesTo: [],
  appliesToAll: false,
  hasExceptions: false,
  ...over,
});

describe("given the row policies a private server holds", () => {
  /** @scenario "A private ClickHouse with a source table not policed for the reader after provisioning warns" */
  it("guards a table only when the reader's own policy is the sole kind on it", () => {
    const tables = ["db.guarded", "db.bare", "db.broad", "db.other", "db.except"];
    const policies = [
      policy({ table: "db.guarded", appliesTo: ["reader"] }),
      policy({ table: "db.broad", appliesTo: ["reader"] }),
      policy({ table: "db.broad", appliesToAll: true }),
      policy({ table: "db.other", appliesTo: ["someone_else"] }),
      policy({ table: "db.except", appliesTo: ["reader"], hasExceptions: true }),
    ];

    expect(unguardedTables({ policies, tables, reader: "reader" })).toEqual([
      "db.bare",
      "db.broad",
      "db.other",
      "db.except",
    ]);
  });
});

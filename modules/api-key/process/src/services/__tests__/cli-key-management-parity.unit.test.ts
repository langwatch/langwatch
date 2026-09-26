/**
 * The CLI keeps its own copy of the management permissions, since the SDK
 * cannot import the contract; this pins the copy to the contract's list.
 * @see specs/ai-gateway/per-team-budget-reorganization.feature
 */
import fs from "node:fs";
import path from "node:path";

import { cliKeyManagementPermissions } from "@langwatch/api-key-contract";
import { describe, expect, it } from "vitest";

const HINT_SOURCE = path.resolve(
  import.meta.dirname,
  "../../../../../../sdks/typescript/src/cli/utils/loginScopeHint.ts",
);

describe("the CLI's management permissions", () => {
  describe("when compared with the permissions a CLI login key leaves out", () => {
    it("names exactly the same ones", () => {
      const listed = /LOGIN_MANAGEMENT_PERMISSIONS: readonly string\[\] = \[([^\]]*)\]/.exec(
        fs.readFileSync(HINT_SOURCE, "utf8"),
      )?.[1];

      expect(
        [...(listed ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]).toSorted(),
      ).toEqual(cliKeyManagementPermissions().toSorted());
    });
  });
});

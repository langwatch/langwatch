/**
 * @vitest-environment node
 * Sensitive management writes carry a declared audit action; reads and ingest carry none.
 */
import { describe, expect, it } from "vitest";

import { roleRest } from "../role.rest.ts";

describe("the management REST audit declaration", () => {
  it("role.rest audits its sensitive writes under their management action", () => {
    const audited = roleRest.router().routes.filter((route) => route.audit !== undefined);

    expect(audited.map((route) => [route.operation, route.audit])).toEqual(
      expect.arrayContaining([
        ["createRole", "management.role.create"],
        ["updateRole", "management.role.update"],
        ["deleteRole", "management.role.delete"],
      ]),
    );
  });
});

/**
 * @vitest-environment node
 * Sensitive management writes carry a declared audit action; reads and ingest carry none.
 */
import { describe, expect, it } from "vitest";

import { projectRest } from "../project.rest.ts";

describe("the management REST audit declaration", () => {
  it("project.rest audits its sensitive writes under their management action", () => {
    const audited = projectRest.router().routes.filter((route) => route.audit !== undefined);

    expect(audited.map((route) => [route.operation, route.audit])).toEqual(
      expect.arrayContaining([
        ["updateProject", "management.project.update"],
        ["archiveProject", "management.project.archive-by-id"],
      ]),
    );
  });
});

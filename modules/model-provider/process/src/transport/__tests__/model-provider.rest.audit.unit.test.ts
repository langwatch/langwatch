/**
 * @vitest-environment node
 * Sensitive management writes carry a declared audit action; reads and ingest carry none.
 */
import { describe, expect, it } from "vitest";

import { modelProviderRest } from "../model-provider.rest.ts";

describe("the management REST audit declaration", () => {
  it("model-provider.rest audits its sensitive writes under their management action", () => {
    const audited = modelProviderRest.router().routes.filter((route) => route.audit !== undefined);

    expect(audited.map((route) => [route.operation, route.audit])).toEqual(
      expect.arrayContaining([
        ["putApiModelProvidersByProvider", "management.model-provider.update"],
      ]),
    );
  });
});

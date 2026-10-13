/**
 * What an edit writes of a resource's external id and metadata.
 * @see specs/ai-gateway/public-rest-api.feature
 */
import { describe, expect, it } from "vitest";

import { identityPatchData } from "../gateway.resource-metadata.ts";

describe("identityPatchData", () => {
  /** @scenario Patching metadata replaces the stored map rather than merging */
  it("writes the map it was given whole, clears the id on null and leaves absent fields out", () => {
    expect(identityPatchData({ metadata: { only: "one" } })).toEqual({ metadata: { only: "one" } });
    expect(identityPatchData({ externalId: null })).toEqual({ externalId: null });
    expect(identityPatchData({ metadata: {} })).toEqual({ metadata: {} });
    expect(identityPatchData({})).toEqual({});
  });
});

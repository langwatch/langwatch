import { describe, expect, it } from "vitest";
import { TOKEN_ACCUMULATION_CONTROL_ATTRIBUTE_KEYS } from "../../canonicalisation/extractors/_constants";
import { buildMetadataKeysFacetQuery } from "../metadata-keys";

const baseCtx = {
  tenantId: "tenant-A",
  timeRange: { from: 1_700_000_000_000, to: 1_700_000_086_400_000 },
  limit: 50,
  offset: 0,
};

describe("buildMetadataKeysFacetQuery", () => {
  it("excludes token-accumulation controls from key discovery", () => {
    const query = buildMetadataKeysFacetQuery(baseCtx);

    for (const key of TOKEN_ACCUMULATION_CONTROL_ATTRIBUTE_KEYS) {
      expect(query.sql).toContain(`'${key}'`);
    }
    expect(query.sql).toContain("key NOT IN");
  });
});

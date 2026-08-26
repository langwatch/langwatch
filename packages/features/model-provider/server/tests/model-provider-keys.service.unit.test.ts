import { MASKED_KEY_PLACEHOLDER } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";
import { ModelProviderKeysService } from "../src/services/model-provider-keys.service";

const policy = ModelProviderKeysService.create();
const stored = [
  { key: "Authorization", value: "Bearer real-secret-abc" },
  { key: "X-Tenant", value: "tenant-42" },
];

describe("ModelProviderKeysService", () => {
  it("restores masked header values by key", () => {
    expect(
      policy.mergeHeaders({
        stored,
        incoming: stored.map(({ key }) => ({ key, value: MASKED_KEY_PLACEHOLDER })),
      }),
    ).toEqual(stored);
  });

  it("uses an unclaimed positional value when a header is renamed", () => {
    expect(
      policy.mergeHeaders({
        stored,
        incoming: [
          { key: "X-Auth", value: MASKED_KEY_PLACEHOLDER },
          { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
        ],
      }),
    ).toEqual([
      { key: "X-Auth", value: "Bearer real-secret-abc" },
      { key: "X-Tenant", value: "tenant-42" },
    ]);
  });

  it("does not assign a claimed secret to a new header after reordering", () => {
    expect(
      policy.mergeHeaders({
        stored,
        incoming: [
          { key: "X-New", value: MASKED_KEY_PLACEHOLDER },
          { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
        ],
      }),
    ).toEqual([{ key: "Authorization", value: "Bearer real-secret-abc" }]);
  });

  it("drops unmatched placeholders and retains explicit values", () => {
    expect(
      policy.mergeHeaders({
        stored,
        incoming: [
          { key: "Authorization", value: "Bearer replacement" },
          { key: "X-Tenant", value: MASKED_KEY_PLACEHOLDER },
          { key: "X-Never-Stored", value: MASKED_KEY_PLACEHOLDER },
        ],
      }),
    ).toEqual([
      { key: "Authorization", value: "Bearer replacement" },
      { key: "X-Tenant", value: "tenant-42" },
    ]);
  });

  it("does not persist a masked value on a new row", () => {
    expect(
      policy.mergeHeaders({
        stored: [],
        incoming: [
          { key: "Authorization", value: MASKED_KEY_PLACEHOLDER },
          { key: "X-Real", value: "real-value" },
        ],
      }),
    ).toEqual([{ key: "X-Real", value: "real-value" }]);
  });
});

import { parse } from "@langwatch/ksuid";
import {
  modelDefaultConfigDeleteTrpcInputSchema,
  modelProviderDeleteTrpcInputSchema,
} from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { PrefixedModelProviderIdService } from "../prefixed-model-provider-id.service.ts";

const ids = PrefixedModelProviderIdService.create();

describe("the ids Model Provider mints", () => {
  it("mints a provider id as a KSUID under main's `provider` resource", () => {
    expect(parse(ids.generate({ type: "provider" })).resource).toBe("provider");
  });

  it("mints a default config id as a KSUID under main's `mdcfg` resource", () => {
    expect(parse(ids.generate({ type: "default" })).resource).toBe("mdcfg");
  });

  it("mints a custom model cost id as a KSUID under the `modelcost` resource", () => {
    expect(parse(ids.generate({ type: "cost" })).resource).toBe("modelcost");
  });

  it("mints a fresh provider id every time", () => {
    expect(ids.generate({ type: "provider" })).not.toBe(ids.generate({ type: "provider" }));
  });
});

describe("the ids a caller may name", () => {
  it.each([
    ["an old prefixed nanoid", "model_provider_V1StGXR8_Z5jdHi6B-myT"],
    ["a bare nanoid main minted", "V1StGXR8_Z5jdHi6B-myT"],
    ["a new KSUID", ids.generate({ type: "provider" })],
  ])("accepts %s as a provider id", (_label, id) => {
    expect(
      modelProviderDeleteTrpcInputSchema.validate({
        id,
        projectId: "project-1",
        provider: "openai",
      }),
    ).toBe(true);
  });

  it.each([
    ["an old prefixed nanoid", "model_default_V1StGXR8_Z5jdHi6B-myT"],
    ["a new KSUID", ids.generate({ type: "default" })],
  ])("accepts %s as a default config id", (_label, id) => {
    expect(modelDefaultConfigDeleteTrpcInputSchema.validate({ id })).toBe(true);
  });
});

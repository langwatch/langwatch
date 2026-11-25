import { generate, KSUID_RESOURCES } from "@langwatch/ksuid";

/** Generates identifiers for records owned by Model Provider. */
export abstract class ModelProviderIdService {
  abstract generate(input: { type: "provider" | "default" | "cost" }): string;
}

/**
 * New ids are KSUIDs under their resource prefix: main's `provider_…` and `mdcfg_…`, and
 * `modelcost_…` (Alex, 2026-09-27). Ids minted before keep their format and stay accepted
 * (ARCHITECTURE.md §3.2, Ids).
 */
const KSUID_RESOURCE = {
  provider: KSUID_RESOURCES.MODEL_PROVIDER,
  default: KSUID_RESOURCES.MODEL_DEFAULT_CONFIG,
  cost: "modelcost",
} as const;

export class PrefixedModelProviderIdService extends ModelProviderIdService {
  static create(): PrefixedModelProviderIdService {
    return new PrefixedModelProviderIdService();
  }

  private constructor() {
    super();
  }

  generate(input: { type: "provider" | "default" | "cost" }): string {
    return generate(KSUID_RESOURCE[input.type]).toString();
  }
}

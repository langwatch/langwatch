import { ModelProviderIdService } from "../ports/model-provider.port";

/**
 * The three id prefixes Model Provider's rows are read back by.
 *
 * They belong to the feature rather than to whatever process happens to write
 * a row: an operator reading `model_default_…` out of a log knows which table
 * it is in, and a second process minting `default_…` would break that for
 * everyone. What the process supplies is only the random half.
 */
const PREFIXES = {
  provider: "model_provider",
  default: "model_default",
  cost: "model_cost",
} as const;

export class PrefixedModelProviderIdAdapter extends ModelProviderIdService {
  static create(input: { suffix: () => string }): PrefixedModelProviderIdAdapter {
    return new PrefixedModelProviderIdAdapter(input.suffix);
  }

  private constructor(private readonly suffix: () => string) {
    super();
  }

  generate(input: { type: "provider" | "default" | "cost" }): string {
    return `${PREFIXES[input.type]}_${this.suffix()}`;
  }
}

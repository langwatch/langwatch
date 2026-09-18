import { ModelProviderIdService } from "../app/model-provider.members.ts";

/**
 * The three id prefixes Model Provider's rows are read back by. They belong
 * to the feature, not the writing process: an operator reading
 * `model_default_…` in a log knows the table; the process supplies only the random half.
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

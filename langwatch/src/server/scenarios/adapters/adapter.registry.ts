/**
 * Registry for target adapter factories.
 *
 * Implements Open/Closed Principle: add new target types by registering
 * new factories, without modifying this class.
 */

import type {
  AdapterCreationContext,
  AdapterResult,
  TargetAdapterFactory,
} from "./adapter.types";

export class TargetAdapterRegistry {
  constructor(private readonly factories: TargetAdapterFactory[]) {}

  async create(context: AdapterCreationContext): Promise<AdapterResult> {
    const factory = this.factories.find((f) =>
      f.supports(context.target.type),
    );

    if (!factory) {
      return {
        success: false,
        error: `Unknown target type: ${context.target.type}`,
      };
    }

    return factory.create(context);
  }
}

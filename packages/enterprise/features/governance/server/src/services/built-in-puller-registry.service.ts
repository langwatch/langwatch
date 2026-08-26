import { PullerRegistryService } from "./puller-registry.service";

export class BuiltInPullerRegistryService {
  private constructor(private readonly registry: PullerRegistryService) {}

  static create(registry: PullerRegistryService): BuiltInPullerRegistryService {
    return new BuiltInPullerRegistryService(registry);
  }

  build(): PullerRegistryService {
    return this.registry;
  }
}

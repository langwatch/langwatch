import type { FacetCatalog } from "../../rules/trace-facet-registry.rules.ts";
import { TraceFacetRegistryRepository } from "../trace-facet-registry.repository.ts";

/** A facet registry held in memory, handed in whole at construction. */
export class MemoryTraceFacetRegistryRepository extends TraceFacetRegistryRepository {
  readonly #catalog: FacetCatalog;

  static create({ catalog }: { catalog: FacetCatalog }): MemoryTraceFacetRegistryRepository {
    return new MemoryTraceFacetRegistryRepository(catalog);
  }

  private constructor(catalog: FacetCatalog) {
    super();
    this.#catalog = catalog;
  }

  getCatalog(): FacetCatalog {
    return this.#catalog;
  }
}

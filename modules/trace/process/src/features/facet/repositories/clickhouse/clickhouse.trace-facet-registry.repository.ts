import type { FacetCatalog } from "../../rules/trace-facet-registry.rules.ts";
import { TraceFacetRegistryRepository } from "../trace-facet-registry.repository.ts";
import { CLICKHOUSE_FACET_CATALOG } from "./clickhouse.trace-facet-registry.mapper.ts";

/** The facet registry over `trace_summaries` and its sibling tables. */
export class ClickHouseTraceFacetRegistryRepository extends TraceFacetRegistryRepository {
  static create(): ClickHouseTraceFacetRegistryRepository {
    return new ClickHouseTraceFacetRegistryRepository();
  }

  private constructor() {
    super();
  }

  getCatalog(): FacetCatalog {
    return CLICKHOUSE_FACET_CATALOG;
  }
}

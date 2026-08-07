import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Span } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { FilterParam } from "~/hooks/useFilterParams";
import type { FilterOptionsRepository } from "~/server/app-layer/filters/repositories/filter-options.clickhouse.repository";
import type { FilterOption } from "./clickhouse";
import type { FilterField } from "./types";

export type GetFilterOptionsInput = {
  projectId: string;
  field: FilterField;
  query?: string;
  key?: string;
  subkey?: string;
  startDate: number;
  endDate: number;
  scopeFilters?: Partial<Record<FilterField, FilterParam>>;
};

/**
 * Service for fetching filter options from ClickHouse.
 */
export class FilterService {
  private readonly logger = createLogger("langwatch:filters:service");
  private readonly tracer = getLangWatchTracer("langwatch.filters.service");

  /**
   * `null` on a deployment without ClickHouse, which is a real configuration
   * rather than a fault - it fails at the call, with the same message it
   * always did, instead of at boot.
   */
  constructor(private readonly repository: FilterOptionsRepository | null) {}

  async getFilterOptions(
    input: GetFilterOptionsInput,
  ): Promise<FilterOption[]> {
    return await this.tracer.withActiveSpan(
      "FilterService.getFilterOptions",
      {
        attributes: {
          "tenant.id": input.projectId,
          "filter.field": input.field,
        },
      },
      async (span) => {
        assertTenantIsolation(input.projectId);
        const repository = this.requireRepository(span);

        try {
          const filterOptions = await repository.findOptions({
            field: input.field,
            tenantId: input.projectId,
            query: input.query,
            key: input.key,
            subkey: input.subkey,
            startDate: input.startDate,
            endDate: input.endDate,
            scopeFilters: input.scopeFilters,
          });

          span.setAttribute("clickhouse.result_count", filterOptions.length);
          return filterOptions;
        } catch (error) {
          throw this.toFilterOptionsFailure({ error, input, span });
        }
      },
    );
  }

  private requireRepository(span: Span): FilterOptionsRepository {
    if (!this.repository) {
      span.setAttribute("clickhouse.available", false);
      throw new Error(
        "ClickHouse client is not available — check ClickHouse connection configuration",
      );
    }
    return this.repository;
  }

  private toFilterOptionsFailure({
    error,
    input,
    span,
  }: {
    error: unknown;
    input: GetFilterOptionsInput;
    span: Span;
  }): Error {
    this.logger.error(
      {
        projectId: input.projectId,
        field: input.field,
        error: error instanceof Error ? error.message : error,
      },
      "Failed to fetch filter options from ClickHouse",
    );
    span.setAttribute("clickhouse.error", true);
    // A handled error is already safe to surface and already carries the
    // code the client renders guidance from - overload in particular,
    // which is a retry-in-a-moment, not a broken filter. Flattening it
    // here would throw away the very thing the typed error exists for.
    if (error instanceof HandledError) return error;
    // Everything else is not rethrown: a raw ClickHouse message embeds
    // the failing SQL (table and column layout), which tRPC would
    // forward to the browser. Details stay in the server log and span.
    return new Error("Failed to fetch filter options");
  }
}

function assertTenantIsolation(projectId: string): void {
  if (!projectId || typeof projectId !== "string" || projectId.trim() === "") {
    throw new Error(
      "Security: projectId (tenantId) must be a non-empty string",
    );
  }
}

import type { AppendStore } from "../../../library/projections/mapProjection.types";
import type { ProjectionStoreContext } from "../../../library/projections/projectionStoreContext";
import type { NormalizedSpan } from "../schemas/spans";
import { spanRepository } from "./index";

/**
 * AppendStore wrapper for span storage.
 *
 * Adapts the existing SpanRepository.insertSpan() to the AppendStore interface
 * used by MapProjection definitions. Each normalized span is appended independently.
 */
export const spanAppendStore: AppendStore<NormalizedSpan> = {
  async append(
    record: NormalizedSpan,
    _context: ProjectionStoreContext,
  ): Promise<void> {
    await spanRepository.insertSpan(record);
  },
};

import type {
  ProjectionStore as BaseProjectionStore,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../library";
import type { TraceProjection } from "../types";

/**
 * Interface for storing and retrieving trace projections.
 */
export interface ProjectionStore extends BaseProjectionStore<string, TraceProjection> {}
export type ProjectionStoreContext = ProjectionStoreReadContext;
export type ProjectionStoreWriteCtx = ProjectionStoreWriteContext;

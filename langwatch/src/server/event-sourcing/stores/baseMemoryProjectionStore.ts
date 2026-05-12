import type { Projection } from "../domain/types";
import type {
	ProjectionStore,
	ProjectionStoreReadContext,
	ProjectionStoreWriteContext,
} from "./projectionStore.types";

/**
 * Base class for in-memory projection stores.
 * Provides common key generation and storage patterns.
 *
 * @example
 * ```typescript
 * export class MyProjectionStoreMemory
 *   extends BaseMemoryProjectionStore<MyProjection>
 *   implements MyProjectionStore
 * {
 *   protected getKey(tenantId: string, aggregateId: string): string {
 *     return `${tenantId}:${aggregateId}`;
 *   }
 * }
 * ```
 */
export abstract class BaseMemoryProjectionStore<
	T extends Projection = Projection,
> implements ProjectionStore<T>
{
	protected readonly store = new Map<string, T>();

	/**
	 * Generates a unique key for storing projections.
	 */
	protected abstract getKey(tenantId: string, aggregateId: string): string;

	async getProjection(
		aggregateId: string,
		context: ProjectionStoreReadContext,
	): Promise<T | null> {
		const key = this.getKey(context.tenantId, aggregateId);
		return this.store.get(key) ?? null;
	}

	async storeProjection(
		projection: T,
		context: ProjectionStoreWriteContext,
	): Promise<void> {
		const key = this.getKey(context.tenantId, projection.aggregateId);
		this.store.set(key, projection);
	}
}

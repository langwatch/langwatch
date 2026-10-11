import type { Operation } from "../../features/api-reference/model/operation.ts";

declare const operations: Record<string, () => Promise<{ default: Operation }>>;
export default operations;

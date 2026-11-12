import type { Operation } from "../../features/api-reference/model.ts";

declare const operations: Record<string, () => Promise<{ default: Operation }>>;
export default operations;

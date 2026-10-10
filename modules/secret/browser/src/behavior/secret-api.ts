/**
 * `secrets` is load-bearing in React Query cache keys. This is the package's
 * sole ADR-004 exception for `@langwatch/api/web`.
 */

// NO SECRET VALUE IS ON ANY SHAPE BELOW, IN EITHER DIRECTION OF A READ.
// `secretSchema` is `.strict()` and has no value field, so one cannot join a
// list answer by accident. Values travel ONE WAY, on `create` and `update`,
// and neither answers one back; `secret-api.unit.test.ts` states that.

import { type ContractApiMap, type ModuleApi, createModuleApi } from "@langwatch/api/web";
import type { secretTrpc } from "@langwatch/secret-contract";

/**
 * The write procedures address a secret as `secretId` rather than `id`: that is
 * the wire `secretTrpc` declares, and the map is that declaration.
 */
export type SecretApiMap = ContractApiMap<typeof secretTrpc>;

/** The Secrets family's typed tRPC hooks. */
export const secretApi: ModuleApi<SecretApiMap> = createModuleApi<SecretApiMap>();

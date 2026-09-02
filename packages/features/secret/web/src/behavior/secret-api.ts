/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself: the procedures are mounted by the process out of
 * `@langwatch/secret-server`, which a web package may not import even for a
 * type, and the router type does not exist until a process instantiates it.
 * Writing it by hand is honest here because every payload below is
 * `@langwatch/secret-contract`'s own.
 *
 * THE SEGMENT NAME IS LOAD-BEARING. `secrets` is a mount point on the root
 * router and tRPC hashes that path into the React Query cache key; spell it
 * differently and these hooks quietly stop sharing a cache with the
 * `api.secrets.*` call sites that have not moved — of which there is one, the
 * optimization studio's code-block secrets indicator.
 *
 * ## NO SECRET VALUE IS ON ANY SHAPE BELOW, IN EITHER DIRECTION OF A READ
 *
 * `Secret` is `{ id, projectId, name, createdAt, updatedAt, createdBy, updatedBy }`
 * and its schema is `.strict()` with the comment "Safe metadata. The encrypted
 * value is deliberately absent." — so a value cannot join a list answer by
 * accident; it would fail the parse. Values travel ONE WAY ONLY, on `create` and
 * `update`, and neither answers one back. That is the property this page exists
 * to keep, and `secret-api.unit.test.ts` asserts the shape of this boundary
 * rather than trusting the projection that satisfies it today.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import type { CreateSecretInput, ListSecretsInput, Secret } from "@langwatch/secret-contract";
import { createFeatureApi } from "@langwatch/platform-api-client";

/**
 * The two writes carry the plaintext value the reader typed, and the SECRET
 * ID uses the transport's own `secretId` spelling rather than the service's
 * `id`. That difference is deliberate on the server — the two legacy input
 * schemas exist to keep this page's calls unchanged — and restating it here is
 * what keeps this map a description of the wire rather than of the service
 * behind it.
 */
type SecretWriteTarget = { projectId: string; secretId: string };

export type SecretApiMap = {
  secrets: {
    /**
     * Every secret in the project, by NAME. Never a value: `Secret` is the
     * contract's "safe metadata" schema and it says so in its own docblock.
     * `createdBy` is the actor row the table's "Created By" column renders.
     */
    list: {
      query: { input: ListSecretsInput; output: Secret[] };
    };

    /** Stores a new secret. The value goes out; the metadata comes back. */
    create: {
      mutation: { input: Omit<CreateSecretInput, "actorId">; output: Secret };
    };

    /** Replaces an existing secret's value. The value goes out, nothing comes back. */
    update: {
      mutation: {
        input: SecretWriteTarget & { value: string };
        output: { success: boolean };
      };
    };

    delete: {
      mutation: { input: SecretWriteTarget; output: { success: boolean } };
    };
  };
};

/**
 * The Secrets family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy — see
 * `createFeatureApi` for why separate instances still share cache entries.
 */
export const secretApi = createFeatureApi<SecretApiMap>();

/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as `api-key-api.ts`,
 * `gateway-api.ts` and the other thirty-six maps say of their own: the
 * procedures are mounted by the process out of `@langwatch/secret-server`,
 * which a web package may not import even for a type, and the router type does
 * not exist until a process instantiates it. Naming `AppRouter` instead — which
 * this file used to do — put the whole API application inside every browser
 * typecheck that reached it (ADR-130).
 *
 * THE SEGMENT NAMES ARE LOAD-BEARING. `secrets` is the mount point on the root
 * router and tRPC hashes that path into the React Query cache key, so a
 * different spelling would quietly stop sharing a cache with any `api.secrets.*`
 * call site that has not moved.
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
 * seals a screen's closure off from `@langwatch/api/web`, and the
 * import below is the only one in the package.
 */

import { type FeatureApi, createFeatureApi } from "@langwatch/api/web";
import type {
  CreateSecretInput,
  ListSecretsInput,
  Secret,
  SecretWriteAcknowledged,
} from "@langwatch/secret-contract";

/**
 * The write procedures address a secret as `secretId` rather than `id`: that is
 * the wire the mounted router declares (`legacyUpdateInputSchema` and
 * `legacyDeleteInputSchema` in `secret.api.ts`), and the map states the wire.
 */
export type SecretApiMap = {
  secrets: {
    /** The project's customer-owned secrets, metadata only — never a value. */
    list: {
      query: { input: ListSecretsInput; output: Secret[] };
    };

    /** A new secret. The value goes out here and is never answered back. */
    create: {
      mutation: { input: Omit<CreateSecretInput, "actorId">; output: Secret };
    };

    /** A new value for an existing secret. */
    update: {
      mutation: {
        input: { projectId: string; secretId: string; value: string };
        output: SecretWriteAcknowledged;
      };
    };

    /** Removal of one secret from the project. */
    delete: {
      mutation: {
        input: { projectId: string; secretId: string };
        output: SecretWriteAcknowledged;
      };
    };
  };
};

/** The Secrets family's typed tRPC hooks. */
export const secretApi: FeatureApi<SecretApiMap> = createFeatureApi<SecretApiMap>();

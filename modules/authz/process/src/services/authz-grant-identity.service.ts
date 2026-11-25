import { createHash } from "node:crypto";

import type { AuthzGrantIdInput } from "@langwatch/authz-contract";
import { Instance, Ksuid, type KsuidLayout } from "@langwatch/ksuid";

import type { AuthzLedgerReadRepository } from "../repositories/authz-ledger-read.repository.ts";

/**
 * Pinned, never read from the ambient environment.
 */
const GRANT_ID_ENVIRONMENT = "prod";

/** The two ids one grant fact derives: "v2", and the "v1-legacy" bytes of grants before #9575. */
export type AuthzGrantIdCandidates = Readonly<{ v2: string; legacy: string }>;

/**
 * Deterministic grant identity (ADR-092 §13 doctrine: ids are functions of
 * event content). A stored id never changes: the one already stored, revoked
 * or not, is reused, and only a grant nothing holds yet gets a v2 id.
 */
export class AuthzGrantIdentityService {
  static create({
    grants,
  }: {
    grants: Pick<AuthzLedgerReadRepository, "findStoredGrantIds">;
  }): AuthzGrantIdentityService {
    return new AuthzGrantIdentityService(grants);
  }

  /** Both ids a grant fact derives, on any pass. Reads nothing. */
  static deriveGrantIdCandidates(input: AuthzGrantIdInput): AuthzGrantIdCandidates {
    return {
      v2: deriveGrantIdIn({ input, layout: "v2" }),
      legacy: deriveGrantIdIn({ input, layout: "v1-legacy" }),
    };
  }

  /** The candidate already stored (v2 first: a v2 mint keeps a revoked legacy twin), else v2. */
  static deriveGrantId({
    storedGrantIds,
    ...input
  }: AuthzGrantIdInput & { storedGrantIds: ReadonlySet<string> }): string {
    const { v2, legacy } = AuthzGrantIdentityService.deriveGrantIdCandidates(input);
    if (storedGrantIds.has(v2)) return v2;
    return storedGrantIds.has(legacy) ? legacy : v2;
  }

  private constructor(
    private readonly grants: Pick<AuthzLedgerReadRepository, "findStoredGrantIds">,
  ) {}

  /** The id this grant fact names, looked up among stored grants, revoked ones included. */
  async resolveGrantId(input: AuthzGrantIdInput): Promise<string> {
    const { v2, legacy } = AuthzGrantIdentityService.deriveGrantIdCandidates(input);
    const stored = await this.grants.findStoredGrantIds({
      organizationId: input.organizationId,
      grantIds: [legacy, v2],
    });
    return AuthzGrantIdentityService.deriveGrantId({ ...input, storedGrantIds: new Set(stored) });
  }
}

function deriveGrantIdIn({
  input: { organizationId, principal, scope, resourceToken, occurredAtMs },
  layout,
}: {
  input: AuthzGrantIdInput;
  layout: KsuidLayout;
}): string {
  const parts = [
    organizationId,
    principal.type,
    principal.id ?? "",
    scope.type,
    scope.id,
    resourceToken ?? "",
  ];
  // ASCII unit separator, not a space: no part may smuggle a boundary
  // character. Written as an escape on purpose - a literal 0x1f byte here is
  // invisible in a diff, so a reader (or a reviewer) sees `join("")` and
  // reads an ambiguous pre-image where there is none.
  const digest = createHash("sha256").update(parts.join("\u001f")).digest();
  const instance = new Instance(
    Instance.schemes.RANDOM,
    new Uint8Array(digest.buffer, digest.byteOffset, 8),
  );
  const sequenceId = digest.readUInt32BE(8);
  const timestampSeconds = Math.floor(occurredAtMs / 1000);
  return new Ksuid({
    environment: GRANT_ID_ENVIRONMENT,
    resource: "grant",
    timestamp: timestampSeconds,
    instance,
    sequenceId,
    layout,
  }).toString();
}

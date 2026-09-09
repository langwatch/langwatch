import { createHash } from "node:crypto";
import { Instance, Ksuid } from "@langwatch/ksuid";
import type { LedgerPrincipal, LedgerScope } from "@langwatch/authz-contract";

/**
 * Pinned, never read from the ambient environment.
 */
const GRANT_ID_ENVIRONMENT = "prod";

/**
 * Deterministic grant identity (ADR-092 §13 doctrine: ids are functions of
 * event content).
 *   links (ADR-057 dropped one-share-per-resource), and the token is the
 */
export class EventingAuthzGrantAdapter {
  static create(): EventingAuthzGrantAdapter {
    return new EventingAuthzGrantAdapter();
  }

  private constructor() {}

  static deriveGrantId({
    organizationId,
    principal,
    scope,
    resourceToken,
    occurredAtMs,
  }: {
    organizationId: string;
    principal: LedgerPrincipal;
    scope: LedgerScope;
    resourceToken?: string;
    occurredAtMs: number;
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
    return new Ksuid(
      GRANT_ID_ENVIRONMENT,
      "grant",
      timestampSeconds,
      instance,
      sequenceId,
    ).toString();
  }
}

/**
 * @see ./langwatch-ql-access-model.service.ts — the key map this value is looked up in
 * @see ../rules/langwatch-ql-query-walk.rules.ts — the `SETTINGS` refusal that clause depends on
 * @see specs/lwql/api.feature
 */

import { createHash } from "node:crypto";

/**
 * The most projects one tenant capability may carry. The set rides in the request URI as a query
 * setting, 65 bytes a project, so this sits well under ClickHouse's 1 MiB URI ceiling and turns an
 * implausibly wide key into a named failure rather than a silently truncated set.
 */
export const LWQL_TENANT_CAPABILITY_MAX_PROJECTS = 10_000;

/** Derives the tenant capability a LangWatchQL query is executed under. */
export class LangWatchQLCapabilityService {
  static create(): LangWatchQLCapabilityService {
    return new LangWatchQLCapabilityService();
  }

  private constructor() {}

  /**
   * The tenant capability for a project, as the key map stores it.
   * @param secret - the project's LangWatchQL secret (`Project.lwqlKey`)
   */
  tenantCapability({ secret }: { secret: string }): string {
    if (!secret) {
      throw new Error("LangWatchQL tenant capability requires a non-empty secret");
    }

    return keyMapToken(secret);
  }

  /**
   * The capability for every project a caller may read: each project's hash, sorted, deduplicated
   * and comma-joined, which the row policy splits back into a set. An empty set derives `''`, the
   * profile's default, which no key hash equals — so a caller reading nothing reads zero rows.
   */
  tenantCapabilitySet({ secrets }: { secrets: readonly string[] }): string {
    if (secrets.length > LWQL_TENANT_CAPABILITY_MAX_PROJECTS) {
      throw new Error(
        `LangWatchQL tenant capability spans ${secrets.length} projects, over the ` +
          `${LWQL_TENANT_CAPABILITY_MAX_PROJECTS} cap — narrow the key's project scope`,
      );
    }
    const hashes = new Set(secrets.map((secret) => this.tenantCapability({ secret })));

    return [...hashes].toSorted().join(",");
  }
}

/** The key-map lookup token: plain sha256-hex, because `KeyHash` is matched by equality. */
function keyMapToken(material: string): string {
  return createHash("sha256").update(material).digest("hex");
}

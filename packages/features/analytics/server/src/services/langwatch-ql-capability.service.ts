/**
 * @see ./provisioning.ts — the key map this value is looked up in
 * @see ../rules/langwatch-ql-query-walk.rules.ts — the `SETTINGS` refusal that clause depends on
 * @see specs/analytics/lwql-api.feature
 */

import { createHash } from "node:crypto";

/** Derives the tenant capability a LangWatchQL query is executed under. */
export class LangWatchQLCapabilityService {
  static create(): LangWatchQLCapabilityService {
    return new LangWatchQLCapabilityService();
  }

  private constructor() {}

  /**
   * The tenant capability for a project, as the key map stores it.
   * nothing a caller does fixes it (ADR-045).
   * @param secret - the project's LangWatchQL secret (`Project.lwqlKey`), in
   */
  tenantCapability({ secret }: { secret: string }): string {
    if (!secret) {
      throw new Error("LangWatchQL tenant capability requires a non-empty secret");
    }

    return createHash("sha256").update(secret).digest("hex");
  }
}

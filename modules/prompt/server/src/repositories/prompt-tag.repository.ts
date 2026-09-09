/**
 * The tag catalogue, as the services see it. Production and staging are
 * seeded as custom tags per organization; `latest` is resolved at query time
 * and never stored, which is why it cannot be created or deleted.
 */
import type { PromptTag } from "@langwatch/prompt-contract";

/** Tags that cannot be created or deleted. Only 'latest' is protected — it is resolved at query time. */
export const PROTECTED_TAGS = ["latest"] as const;
export type ProtectedTag = (typeof PROTECTED_TAGS)[number];

/** Repository for managing prompt tag definitions. */
export abstract class PromptTagRepository {
  /**
   * Creates a custom tag definition for an org.
   * Name validation is the caller's responsibility.
   */
  abstract create(params: {
    organizationId: string;
    name: string;
    createdById?: string;
  }): Promise<PromptTag>;

  abstract findAll(params: { organizationId: string }): Promise<PromptTag[]>;

  abstract tryFindById(params: { id: string; organizationId: string }): Promise<PromptTag | null>;

  abstract delete(params: { id: string; organizationId: string }): Promise<void>;

  abstract tryFindByName(params: {
    organizationId: string;
    name: string;
  }): Promise<PromptTag | null>;

  abstract deleteByName(params: { organizationId: string; name: string }): Promise<void>;

  abstract rename(params: {
    organizationId: string;
    oldName: string;
    newName: string;
  }): Promise<PromptTag>;

  abstract existsForOrg(params: { tag: string; organizationId: string }): Promise<boolean>;

  abstract tryFindByOrgAndName(params: {
    organizationId: string;
    name: string;
  }): Promise<PromptTag | null>;

  abstract seedForOrg(params: { organizationId: string }): Promise<void>;
}

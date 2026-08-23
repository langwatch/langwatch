import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { vi } from "vitest";
import type { ApiKeyWithBindings } from "../api-key.repository";

export const ORG_ID = "org_1";
export const KEY_ID = "apikey_1";
export const CREATED_AT = new Date("2024-03-01T10:00:00.000Z");
/** The organization's genesis import began after this key was created. */
export const GENESIS_AT = new Date("2024-06-01T00:00:00.000Z");

/** A legacy-shaped service key: org-owned, no bindings, born before genesis. */
export function serviceKey(
  overrides: Partial<ApiKeyWithBindings> = {},
): ApiKeyWithBindings {
  return {
    id: KEY_ID,
    name: "deploy bot",
    organizationId: ORG_ID,
    userId: null,
    createdAt: CREATED_AT,
    ingestSourceType: null,
    roleBindings: [],
    ...overrides,
  } as ApiKeyWithBindings;
}

export function writerSpy() {
  const attachBindings = vi
    .fn()
    .mockResolvedValue({ attached: [], duplicates: [] });
  return {
    attachBindings,
    writer: { attachBindings } as unknown as AuthzGrantsService,
  };
}

/** Lets the fire-and-forget promise settle before assertions on failure. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The mint is per-organization; these cases are about an org past genesis. */
export const onMigratedOrg = async () => true;

/** The key under test predates this organization's genesis import. */
export const afterGenesis = async () => GENESIS_AT;

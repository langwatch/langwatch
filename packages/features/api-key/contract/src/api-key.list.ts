/**
 * One API key row, as the Settings > API Keys table reads it.
 *
 * This is the answer of `apiKey.list`, declared rather than inferred. Before
 * the family moved out of `platform/app`, the page typed its rows as
 * `RouterOutputs["apiKey"]["list"][number]` — the whole shape derived from an
 * `AppRouter` a browser package may not name. The producer is PACKAGED
 * (`@langwatch/api-key-server`'s `ApiKeyApp.listKeys`), so the ruling on
 * contract moves allows the real fix rather than a restatement: the app method
 * is ANNOTATED with this type, and both halves are now checked against one
 * declaration.
 *
 * ## NO KEY MATERIAL IS ON THIS SHAPE, and that is the point of writing it down
 *
 * `lookupIdPrefix` is five characters of the key's LOOKUP id — the public half
 * that identifies which row a presented credential belongs to. It is not a
 * prefix of the secret. The plaintext token exists in exactly one answer in this
 * feature, `apiKey.create`, at the moment of minting; every read hands back this
 * row and nothing more. Widening this type with a token, a hash, or the full
 * lookup id would turn a list request into a credential disclosure, which is why
 * the rule is stated here rather than left to the projection that happens to
 * satisfy it today.
 */

import type { ApiKeyBinding } from "./api-key";

/**
 * One of the CALLER's own bindings, with the scope named rather than only
 * identified. The answer of `apiKey.myBindings`, which both drawers and the CLI
 * authorize screen read to work out the ceiling a new key may be given.
 *
 * Declared here rather than in `@langwatch/api-key-server` — where it lived,
 * with no consumer outside that package's own barrel — because a browser
 * package may not import a server one, and this is a DTO rather than anything
 * the server owns.
 */
export type NamedApiKeyBinding = ApiKeyBinding & {
  scopeName: string | null;
  customRoleName: string | null;
};

/** One role binding on a key, with the names its row renders. */
export interface ApiKeyListRoleBinding {
  id: string;
  role: string;
  customRoleId: string | null;
  /** The custom role's display name, when the binding names one. */
  customRoleName: string | null;
  /** The custom role's permission list, which the edit drawer reads back. */
  customRolePermissions: string[] | null;
  scopeType: string;
  scopeId: string;
  /** The organization, team or project name the scope id resolves to. */
  scopeName: string | null;
}

/** One API key, as every read of the feature answers it. */
export interface ApiKeyListEntry {
  id: string;
  /** Five characters of the PUBLIC lookup id. Never any part of the secret. */
  lookupIdPrefix: string;
  name: string;
  description: string | null;
  permissionMode: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  /**
   * Non-null marks this as an ingestion key: a project-scoped, ingest-only
   * write credential the `langwatch <tool>` CLI mints. `null` is a regular
   * personal or service key. The API Keys page renders the two in separate
   * sections on this field alone.
   */
  ingestSourceType: string | null;
  ingestionTemplateId: string | null;
  /** Human label of the CLI device session that minted an ingestion key. */
  createdByDeviceLabel: string | null;
  roleBindings: ApiKeyListRoleBinding[];
}

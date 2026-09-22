import type { SsoCredentialKind } from "@langwatch/identity-contract";

import { newSsoCredentialId } from "../../rules/sso-connection-id.rules.ts";
import { type SsoCredentialRead, SsoCredentialRepository } from "../sso-credential.repository.ts";
import type { MemoryIdentityStore } from "./memory-identity.store.ts";

/** The vault's twin: the same write-once reference, held in the store. */
export class MemorySsoCredentialRepository extends SsoCredentialRepository {
  static create(store: MemoryIdentityStore): MemorySsoCredentialRepository {
    return new MemorySsoCredentialRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {
    super();
  }

  async put({
    organizationId,
    connectionId,
    kind,
    value,
  }: {
    organizationId: string;
    connectionId: string;
    kind: SsoCredentialKind;
    value: string;
  }): Promise<string> {
    const id = newSsoCredentialId();
    this.store.ssoCredentials.set(id, { organizationId, connectionId, kind, value });

    return id;
  }

  async read({
    organizationId,
    ref,
  }: {
    organizationId: string;
    ref: string;
  }): Promise<SsoCredentialRead> {
    const held = this.store.ssoCredentials.get(ref);
    if (!held || held.organizationId !== organizationId) return { found: false };

    return { found: true, value: held.value };
  }
}

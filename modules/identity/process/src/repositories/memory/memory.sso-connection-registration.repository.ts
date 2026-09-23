import { findBlockingRegistrationSlots } from "../../rules/sso-connection-registration.rules.ts";
import {
  SsoConnectionRegistrationRepository,
  type SsoConnectionRegistrationSlot,
} from "../sso-connection-registration.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

/** The slot table beside the connection heads; the rule is the Postgres twin's. */
export class MemorySsoConnectionRegistrationRepository extends SsoConnectionRegistrationRepository {
  static create(store: MemoryIdentityStore): MemorySsoConnectionRegistrationRepository {
    return new MemorySsoConnectionRegistrationRepository(store);
  }

  private constructor(private readonly store: MemoryIdentityStore) {
    super();
  }

  async claim(candidate: SsoConnectionRegistrationSlot): Promise<SsoConnectionRegistrationSlot> {
    const slots = [...this.store.ssoRegistrationSlots.values()].filter(
      (slot) => slot.organizationId === candidate.organizationId,
    );
    const stateByConnection = new Map(
      [...this.store.ssoConnections.values()].map((connection) => [
        connection.connectionId,
        connection.state,
      ]),
    );
    const [blocking] = findBlockingRegistrationSlots({ candidate, slots, stateByConnection });
    if (blocking) return blocking;

    this.store.ssoRegistrationSlots.set(`${candidate.organizationId}:${candidate.kind}`, candidate);
    return candidate;
  }
}

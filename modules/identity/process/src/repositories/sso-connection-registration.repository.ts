/** One organization holds at most one direct and one legacy connection. */
export const SSO_CONNECTION_REGISTRATION_KINDS = ["legacy", "direct"] as const;
export type SsoConnectionRegistrationKind = (typeof SSO_CONNECTION_REGISTRATION_KINDS)[number];

export interface SsoConnectionRegistrationSlot {
  organizationId: string;
  kind: SsoConnectionRegistrationKind;
  connectionId: string;
  replacesConnectionId: string | null;
  commandId: string;
}

/**
 * The pre-event registration lock. Claims serialize per organization before
 * either caller may append a registration fact; the only two-slot shape is a
 * direct replacement naming the organization's legacy slot.
 */
export abstract class SsoConnectionRegistrationRepository {
  /** Takes the slot, or answers the slot that stands in the way. */
  abstract claim(candidate: SsoConnectionRegistrationSlot): Promise<SsoConnectionRegistrationSlot>;
}

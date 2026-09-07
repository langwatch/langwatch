export const SSO_CONNECTION_REGISTRATION_KINDS = ["legacy", "direct"] as const;
export type SsoConnectionRegistrationKind =
  (typeof SSO_CONNECTION_REGISTRATION_KINDS)[number];

export interface SsoConnectionRegistrationSlot {
  organizationId: string;
  kind: SsoConnectionRegistrationKind;
  connectionId: string;
  replacesConnectionId: string | null;
  commandId: string;
}

/**
 * The pre-event connection slot. Claims serialize per organization before
 * either caller may append a registration fact. This is wider than the
 * legacy/direct slot key: the only allowed two-slot shape is a direct
 * replacement naming that organization's legacy slot. Terminal projection
 * rows allow a slot to be reused; a missing row does not, because it may be a
 * winning append still in flight.
 */
export interface SsoConnectionRegistrationRepository {
  claim(args: SsoConnectionRegistrationSlot): Promise<SsoConnectionRegistrationSlot>;
}

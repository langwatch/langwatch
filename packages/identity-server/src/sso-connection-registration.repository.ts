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
 * The pre-event connection slot. A claim is one atomic database statement,
 * so concurrent registrations learn the same winner before either may append
 * a registration fact. Terminal projection rows allow the slot to be reused;
 * a missing row does not, because it may be a winning append still in flight.
 */
export interface SsoConnectionRegistrationRepository {
  claim(args: SsoConnectionRegistrationSlot): Promise<SsoConnectionRegistrationSlot>;
}

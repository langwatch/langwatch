/**
 * The two things the sign-in gate has to ask about that a connection's own
 * folded state cannot answer: who an asserted address belongs to, and whether
 * a lapsed domain's record can be read again.
 */

export interface SsoRegistrantReads {
  /** Whether this address belongs to the named person, who is STILL a member
   *  here. Both halves are load-bearing: the address keeps a colleague's out
   *  of a connection under setup, the membership stops a registrant who left. */
  findRegistrantAtAddress(args: {
    organizationId: string;
    userId: string;
    email: string;
  }): Promise<boolean>;
  /**
   * Whether this exact connection subject was already bound to a current
   * member at the asserted address, before the ownership evidence lapsed.
   */
  findBoundMemberIdentity(args: {
    organizationId: string;
    connectionId: string;
    accountId: string;
    email: string;
  }): Promise<boolean>;
}

/**
 * Asks for one domain's published record to be read again, out of band: a
 * lapsed-proof refusal is evidence somebody is being turned away right now,
 * and a sign-in path must never wait on somebody else's nameservers.
 */
export interface SsoDomainReproofRequest {
  requestReproof(args: { connectionId: string; domain: string }): Promise<void>;
}

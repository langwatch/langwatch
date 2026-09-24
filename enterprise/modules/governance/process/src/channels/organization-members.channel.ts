// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The organization's members as the match engine reads them; the organization module owns the rows. */
export interface OrganizationMembersChannel {
  /** Confirmed addresses only: an unconfirmed one is a claim anyone can type into a profile. */
  findVerifiedMemberEmails(input: {
    organizationId: string;
  }): Promise<{ userId: string; email: string }[]>;
  /** The display name a suggestion scores against, the address standing in where there is none. */
  findMemberNames(input: { organizationId: string }): Promise<{ userId: string; name: string }[]>;
}

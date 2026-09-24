// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The identity provider's own identifiers for the organization's members, across its directories. */
export interface DirectoryIdentifiersChannel {
  findDirectoryIds(input: {
    organizationId: string;
  }): Promise<{ userId: string; externalId: string }[]>;
}

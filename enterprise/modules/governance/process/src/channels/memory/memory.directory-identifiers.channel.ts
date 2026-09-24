// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { DirectoryIdentifiersChannel } from "../directory-identifiers.channel.ts";

type MemoryDirectoryIdentifier = { organizationId: string; userId: string; externalId: string };

/** Directory identifiers in memory, keyed by the organization whose directory issued them. */
export class MemoryDirectoryIdentifiersChannel implements DirectoryIdentifiersChannel {
  private readonly identifiers: MemoryDirectoryIdentifier[] = [];

  private constructor() {}

  static create(): MemoryDirectoryIdentifiersChannel {
    return new MemoryDirectoryIdentifiersChannel();
  }

  seed(identifier: MemoryDirectoryIdentifier): void {
    this.identifiers.push(identifier);
  }

  async findDirectoryIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ userId: string; externalId: string }[]> {
    return this.identifiers.flatMap((row) =>
      row.organizationId === organizationId
        ? [{ userId: row.userId, externalId: row.externalId }]
        : [],
    );
  }
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { ScimWriteOutsideConnectionError } from "@langwatch/enterprise-scim-contract";
import type { ScimRepositoryPort } from "../ports/scim-repository.port";

/** Resolves a directory identity only within the connection that asserted it. */
export class ScimDirectoryIdentityService {
  private constructor(private readonly repository: ScimRepositoryPort) {}

  static create(repository: ScimRepositoryPort): ScimDirectoryIdentityService {
    return new ScimDirectoryIdentityService(repository);
  }

  tryGetUserId(input: { connectionId: string; externalId: string }): Promise<string | null> {
    return this.repository.tryFindDirectoryUserId(input);
  }

  remember(input: { connectionId: string; externalId: string; userId: string }): Promise<void> {
    return this.repository.rememberDirectoryIdentity(input);
  }

  forget(input: { connectionId: string; externalId: string }): Promise<void> {
    return this.repository.forgetDirectoryIdentity(input);
  }

  forgetUser(input: { connectionId: string; userId: string }): Promise<void> {
    return this.repository.forgetDirectoryIdentitiesForUser(input);
  }

  async assertWritable(input: { connectionId: string | null; userId: string }): Promise<void> {
    if (input.connectionId === null) return;

    const claims = await this.repository.listDirectoryConnectionsForUser({
      userId: input.userId,
    });
    if (claims.length === 0 || claims.includes(input.connectionId)) return;

    throw new ScimWriteOutsideConnectionError({ userId: input.userId });
  }
}

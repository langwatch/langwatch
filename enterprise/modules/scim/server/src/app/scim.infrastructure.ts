export interface SCIMInfrastructure {  scimSyncLifecycle: ScimSyncLifecycle;
}

// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export type ScimUserPushOperation = "create" | "update" | "deactivate";

export type ScimRemovalOperation = "delete_user" | "deactivate_user";

/** Durable directory-sync history supplied by the API process composition. */
export interface ScimSyncLifecycle {
  tokenIssued(input: {
    organizationId: string;
    connectionId: string;
    tokenId: string;
  }): Promise<void>;

  userPushed(input: {
    organizationId: string;
    connectionId: string;
    userId: string;
    externalId: string;
    op: ScimUserPushOperation;
  }): Promise<void>;

  groupMapped(input: {
    organizationId: string;
    connectionId: string;
    groupId: string;
    externalId: string | null;
  }): Promise<void>;

  applyFailed(input: {
    organizationId: string;
    connectionId: string;
    op: ScimRemovalOperation;
    errorCode: string;
    retryable: boolean;
    userId: string;
  }): Promise<void>;

  revoked(input: {
    organizationId: string;
    connectionId: string;
    tokenId: string | null;
    cause: "revoke" | "teardown";
  }): Promise<void>;
}

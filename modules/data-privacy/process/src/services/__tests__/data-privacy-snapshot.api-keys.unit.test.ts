import type { ApiKey } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  type DataPrivacyPolicy,
  PLATFORM_DEFAULT_DATA_PRIVACY,
} from "@langwatch/data-privacy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { fromDate } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryDataPrivacyDirectoryRepository } from "../../repositories/memory/memory.data-privacy-directory.repository.ts";
import { DataPrivacyPermissionsService } from "../data-privacy-permissions.service.ts";
import { DataPrivacySnapshotService } from "../data-privacy-snapshot.service.ts";

const NOW = new Date("2026-11-26T12:00:00Z");

function key(id: string, name: string, overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id,
    name,
    description: null,
    organizationId: "organization-1",
    userId: null,
    createdByUserId: null,
    createdByDeviceLabel: null,
    lookupId: `lookup-${id}`,
    permissionMode: "all",
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: NOW,
    updatedAt: NOW,
    grants: [],
    ...overrides,
  };
}

const KEYS = [
  key("key-service", "Trace analysis agent"),
  key("key-personal", "Nightly eval runner", { userId: "user-1" }),
  key("key-langy", "Langy session", { isSystemManaged: true }),
];

function snapshots({
  canEdit,
  orgAdmin = canEdit,
  listAll = async () => KEYS,
  rules = [],
}: {
  canEdit: boolean;
  orgAdmin?: boolean;
  listAll?: () => Promise<ApiKey[]>;
  rules?: DataPrivacyPolicy[];
}) {
  const authz = createApiFixture<AuthzApi>({
    hasPermission: async () => orgAdmin,
    canBatchByIds: async ({ projects }) => ({
      teams: new Map<string, boolean>(),
      projects: new Map(projects.map((p): [string, boolean] => [p.projectId, canEdit])),
      organizationRole: null,
    }),
  });
  return DataPrivacySnapshotService.create({
    policies: {
      getResolvedForProject: async () => PLATFORM_DEFAULT_DATA_PRIVACY,
      listOrganizationRules: async () => rules,
    },
    directory: MemoryDataPrivacyDirectoryRepository.create({
      lineage: {
        projectId: "project-1",
        name: "web-app",
        teamId: "team-1",
        organizationId: "organization-1",
        organizationName: "Acme",
      },
      directory: {
        departments: [],
        teams: [],
        projects: [{ id: "project-1", name: "web-app", teamId: "team-1" }],
        groups: [],
      },
    }),
    permissions: DataPrivacyPermissionsService.create({ authz }),
    apiKeys: { listAll },
    acceptance: { isAccepted: async () => true },
    clock: () => fromDate(NOW),
  });
}

describe("DataPrivacySnapshotService audience options", () => {
  /** @scenario The audience picker lists the organization's keys by name */
  it("offers someone who may edit a rule the organization's keys by name", async () => {
    const snapshot = await snapshots({ canEdit: true }).getSnapshot({
      userId: "user-admin",
      projectId: "project-1",
    });
    expect(snapshot.audienceOptions.apiKeys).toEqual([
      { id: "key-service", name: "Trace analysis agent" },
    ]);
    expect(snapshot.audienceOptions.canAddApiKeys).toBe(true);
  });

  it("lists no key to someone who may edit no rule", async () => {
    const snapshot = await snapshots({ canEdit: false }).getSnapshot({
      userId: "user-viewer",
      projectId: "project-1",
    });
    expect(snapshot.audienceOptions.apiKeys).toEqual([]);
  });

  it("shows a member who may edit a rule only the keys the rules already name", async () => {
    const rule: DataPrivacyPolicy = {
      id: "rule-1",
      organizationId: "organization-1",
      scopeType: "PROJECT",
      scopeId: "project-1",
      personalOnly: false,
      config: {
        categories: {
          input: {
            disposition: "restrict",
            audience: { admins: true, apiKeyIds: ["key-service"] },
          },
        },
      },
      createdAt: NOW,
      updatedAt: NOW,
    };
    const snapshot = await snapshots({ canEdit: true, orgAdmin: false, rules: [rule] }).getSnapshot(
      {
        userId: "user-member",
        projectId: "project-1",
      },
    );
    expect(snapshot.audienceOptions.apiKeys).toEqual([
      { id: "key-service", name: "Trace analysis agent" },
    ]);
    expect(snapshot.audienceOptions.canAddApiKeys).toBe(false);
  });

  it("lists no key, and asks api-key nothing, for a member whose rules name none", async () => {
    let asked = false;
    const snapshot = await snapshots({
      canEdit: true,
      orgAdmin: false,
      listAll: async () => {
        asked = true;
        return KEYS;
      },
    }).getSnapshot({ userId: "user-member", projectId: "project-1" });
    expect(snapshot.audienceOptions.apiKeys).toEqual([]);
    expect(asked).toBe(false);
  });

  /** @scenario The picker says when the API keys could not be loaded */
  it("still opens the page when the key list cannot be read", async () => {
    const snapshot = await snapshots({
      canEdit: true,
      listAll: async () => {
        throw new Error("api-key unavailable");
      },
    }).getSnapshot({ userId: "user-admin", projectId: "project-1" });
    expect(snapshot.audienceOptions.apiKeys).toEqual([]);
    expect(snapshot.audienceOptions.apiKeysUnavailable).toBe(true);
  });

  it("says nothing about availability when the key list was read", async () => {
    const snapshot = await snapshots({ canEdit: true }).getSnapshot({
      userId: "user-admin",
      projectId: "project-1",
    });
    expect(snapshot.audienceOptions.apiKeysUnavailable).toBeUndefined();
  });
});

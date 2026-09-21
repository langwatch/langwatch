/**
 * One representative API response per management family, each carrying fields
 * the human table never prints. They live here rather than inline so the test
 * that walks them stays about the assertion, and so a family added later has
 * an obvious place to land.
 */

export const ORGANIZATION_SETTINGS_RESPONSE = {
  id: "org_1",
  name: "Acme",
  slug: "acme",
  supportContact: null,
  presenceEnabled: true,
  traceSharingEnabled: false,
  primaryIntent: null,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3Bucket: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
} as const;

export const LIST_MEMBERS_RESPONSE = {
  members: [
    {
      userId: "user_1",
      role: "ADMIN",
      disabled: false,
      disabledAt: null,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      user: { id: "user_1", name: "Ada", email: "ada@example.com" },
    },
  ],
  totalCount: 1,
} as const;

export const LIST_ROLES_RESPONSE = {
  roles: [
    {
      id: "role_1",
      name: "Analyst",
      description: null,
      permissions: ["project:view"],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
} as const;

export const LIST_TEAMS_RESPONSE = {
  data: [
    {
      id: "team_1",
      name: "Platform",
      slug: "platform",
      organizationId: "org_1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
  pagination: { page: 1, limit: 50, total: 1 },
} as const;

export const LIST_GROUPS_RESPONSE = {
  data: [
    {
      id: "group_1",
      name: "Data science",
      slug: "data-science",
      externalId: null,
      scimSource: null,
      memberCount: 3,
      bindings: [],
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
  pagination: { page: 1, limit: 50, total: 1 },
} as const;

export const CREATED_GROUP_BINDING_RESPONSE = {
  id: "rb_1",
  role: "MEMBER",
  scopeType: "PROJECT",
  scopeId: "project_1",
} as const;

export const LIST_ROLE_BINDINGS_RESPONSE = {
  bindings: [
    {
      id: "rb_1",
      principal: { type: "user", id: "user_1", name: "Ada" },
      role: "ADMIN",
      customRoleId: null,
      customRoleName: null,
      scopeType: "TEAM",
      scopeId: "team_1",
      scopeName: "Platform",
      createdAt: "2026-01-01T00:00:00Z",
    },
  ],
  totalCount: 1,
} as const;

export const UPDATED_API_KEY_RESPONSE = {
  id: "key_1",
  name: "Analyst key",
  description: null,
  keyType: "service",
  assignedToUserId: null,
  createdByUserId: null,
  permissionMode: "restricted",
  permissions: ["project:view", "trace:view"],
  createdAt: "2026-01-01T00:00:00Z",
  expiresAt: null,
  lastUsedAt: null,
  revokedAt: null,
  roleBindings: [],
  bindings: [],
} as const;

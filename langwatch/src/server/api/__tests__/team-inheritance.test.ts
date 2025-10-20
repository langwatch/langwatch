import { describe, it, expect, beforeEach, vi } from "vitest";
import { TeamUserRole, OrganizationUserRole } from "@prisma/client";
import {
  hasProjectPermission,
  hasTeamPermission,
  Resources,
  type Permission,
} from "../rbac";

// Mock Prisma client
const mockPrisma = {
  project: {
    findUnique: vi.fn(),
  },
  team: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  organizationUser: {
    findFirst: vi.fn(),
  },
  teamUser: {
    findFirst: vi.fn(),
  },
  teamUserCustomRole: {
    findFirst: vi.fn(),
  },
} as any;

// Mock session
const mockSession = {
  user: {
    id: "user-123",
    email: "test@example.com",
  },
} as any;

// Removed: tests for team-level default role baseline checks and inheritance.
// These behaviors were removed from RBAC; permissions now derive from
// user-specific team role or assigned custom role only (plus org-admin override).

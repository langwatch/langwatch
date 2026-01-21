# RBAC System

## Overview

Three-level permission hierarchy: Organization → Team → Project

## Key Files

- `src/server/api/rbac.ts` - New RBAC system (preferred)
- `src/server/api/permission.ts` - Legacy system (backward compatible)
- `src/hooks/useOrganizationTeamProject.ts` - Client-side hooks

## Roles

**Team roles** (`TeamUserRole` in Prisma):
- `ADMIN` - Full control, manage members, create/delete projects
- `MEMBER` - Create/modify resources, view costs, no member management
- `VIEWER` - Read-only, no costs

**Organization roles** (`OrganizationUserRole`):
- `ADMIN` - Full control, implicit admin on all teams
- `MEMBER` - View org details
- `EXTERNAL` - Limited external collaborator access

## Permission Format

New system uses `resource:action` format:
```typescript
type Permission = `${Resource}:${Action}`;
// "analytics:view", "datasets:manage", "project:create"
```

## Usage

```typescript
// Server-side
import { checkPermissionOrThrow } from "~/server/api/rbac";
await checkPermissionOrThrow({ permission: "analytics:view", projectId });

// Client-side
const { hasPermission } = useOrganizationTeamProject();
if (hasPermission("analytics:view")) { ... }
```

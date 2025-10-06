# RBAC (Role-Based Access Control) System

## Overview

LangWatch implements a comprehensive RBAC system to manage permissions across the platform. The system operates at three levels:

- **Organization**: Top-level entity
- **Team**: Groups within an organization
- **Project**: Individual projects within a team

## Architecture

### Files

- **`src/server/api/rbac.ts`**: New RBAC system (preferred)
- **`src/server/api/permission.ts`**: Legacy permission system (backward compatible)
- **`src/hooks/useOrganizationTeamProject.ts`**: Client-side permission hooks

## Roles

### Team Roles

Defined in Prisma schema: `TeamUserRole`

1. **ADMIN**

   - Full control over the team
   - Can manage members, projects, and all resources
   - Can create and delete projects

2. **MEMBER**

   - Can create and modify most resources
   - Can view costs and debug information
   - Cannot manage team members or delete projects

3. **VIEWER**
   - Read-only access
   - Can view analytics, messages, and guardrails
   - Cannot see costs or modify anything

### Organization Roles

Defined in Prisma schema: `OrganizationUserRole`

1. **ADMIN**

   - Full control over the organization
   - Can manage teams and billing
   - Has implicit admin rights on all teams

2. **MEMBER**

   - Can view organization details
   - Standard member access

3. **EXTERNAL**
   - Limited view access for external collaborators

## Permission System

### New RBAC System (Preferred)

The new system uses a `resource:action` format for permissions:

```typescript
type Permission = `${Resource}:${Action}`;

// Examples:
// "analytics:view"
// "datasets:manage"
// "project:create"
```

#### Resources

All resources that can have permissions:

- `project`
- `analytics`
- `cost`
- `messages`
- `annotations`
- `spans`
- `guardrails`
- `experiments`
- `datasets`
- `triggers`
- `playground`
- `workflows`
- `prompts`
- `scenarios`
- `team`
- `organization`

#### Actions

Standard actions that can be performed:

- `view` - Read access
- `create` - Create new items
- `update` - Modify existing items
- `delete` - Remove items
- `manage` - Full CRUD + settings
- `share` - Share with others
- `execute` - Run/execute (e.g., playground)
- `debug` - Access debug information

### Client-Side Usage

```typescript
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

function MyComponent() {
  const { hasPermission } = useOrganizationTeamProject();

  // New RBAC API (preferred)
  if (hasPermission("analytics:view")) {
    // Show analytics
  }

  if (hasPermission("datasets:manage")) {
    // Show edit/delete buttons
  }

  // Legacy API (still supported)
  if (hasTeamPermission(TeamRoleGroup.ANALYTICS_VIEW)) {
    // Old way still works
  }
}
```

### Server-Side Usage

#### TRPC Middleware

```typescript
import { checkProjectPermission } from "~/server/api/rbac";

export const myProcedure = protectedProcedure
  .input(z.object({ projectId: z.string() }))
  .use(checkProjectPermission("analytics:view"))
  .query(async ({ input }) => {
    // User is authorized
  });
```

#### Manual Permission Checks

```typescript
import { hasProjectPermission } from "~/server/api/rbac";

async function myFunction(ctx, projectId: string) {
  if (!(await hasProjectPermission(ctx, projectId, "datasets:manage"))) {
    throw new Error("Unauthorized");
  }

  // Continue with authorized action
}
```

### Helper Functions

The new RBAC system provides convenient helpers:

```typescript
import { canView, canManage, canCreate } from "~/server/api/rbac";

// Check if role can view a resource
canView(TeamUserRole.VIEWER, "analytics"); // true
canView(TeamUserRole.VIEWER, "cost"); // false

// Check if role can manage a resource
canManage(TeamUserRole.MEMBER, "datasets"); // true
canManage(TeamUserRole.VIEWER, "datasets"); // false

// Check if role can create a resource
canCreate(TeamUserRole.ADMIN, "project"); // true
canCreate(TeamUserRole.MEMBER, "project"); // false
```

## Permission Matrix

### Team Roles Permission Matrix

| Resource    | ADMIN                                | MEMBER        | VIEWER |
| ----------- | ------------------------------------ | ------------- | ------ |
| Project     | view, create, update, delete, manage | view, update  | view   |
| Analytics   | view, manage                         | view, manage  | view   |
| Cost        | view                                 | view          | ❌     |
| Messages    | view, share                          | view, share   | view   |
| Annotations | view, manage                         | view, manage  | view   |
| Spans       | view, debug                          | view, debug   | view   |
| Guardrails  | view, manage                         | view, manage  | view   |
| Experiments | view, manage                         | view, manage  | view   |
| Datasets    | view, manage                         | view, manage  | view   |
| Triggers    | view, manage                         | view, manage  | ❌     |
| Playground  | view, execute                        | view, execute | ❌     |
| Workflows   | view, manage                         | view, manage  | view   |
| Prompts     | view, manage                         | view, manage  | view   |
| Scenarios   | view, manage                         | view, manage  | view   |
| Team        | view, manage                         | view          | view   |

## Special Cases

### Organization Admin Override

Organization ADMINs have **implicit admin rights on all teams** within their organization, even if they're not explicitly added to the team.

### Demo Project

The system has special handling for a demo project (defined in `env.DEMO_PROJECT_ID`) that allows public access to view-only permissions.

### Public Sharing

Some resources (traces, threads) can be publicly shared. The system checks both:

1. User permissions
2. Public share records

If either allows access, the request succeeds.

## Migration Guide

### From Legacy to New RBAC

The system provides backward compatibility while you migrate:

```typescript
// OLD WAY (still works)
import {
  TeamRoleGroup,
  checkUserPermissionForProject,
} from "~/server/api/permission";

export const oldProcedure = protectedProcedure
  .use(checkUserPermissionForProject(TeamRoleGroup.ANALYTICS_VIEW))
  .query(async ({ input }) => {
    // ...
  });

// NEW WAY (preferred)
import { checkProjectPermission } from "~/server/api/rbac";

export const newProcedure = protectedProcedure
  .use(checkProjectPermission("analytics:view"))
  .query(async ({ input }) => {
    // ...
  });
```

### Mapping Table

The `LEGACY_TO_RBAC_MAPPING` in `permission.ts` provides a complete mapping:

```typescript
PROJECT_VIEW → "project:view"
ANALYTICS_VIEW → "analytics:view"
ANALYTICS_MANAGE → "analytics:manage"
DATASETS_MANAGE → "datasets:manage"
// ... and so on
```

## Adding New Permissions

To add a new permission:

1. **Add Resource or Action** (if needed) in `src/server/api/rbac.ts`:

   ```typescript
   export const Resources = {
     // ...
     MY_NEW_RESOURCE: "myNewResource",
   } as const;
   ```

2. **Update Role Permissions**:

   ```typescript
   const TEAM_ROLE_PERMISSIONS: Record<TeamUserRole, Permission[]> = {
     [TeamUserRole.ADMIN]: [
       // ...
       "myNewResource:view",
       "myNewResource:manage",
     ],
     // ... other roles
   };
   ```

3. **Use in Code**:
   ```typescript
   .use(checkProjectPermission("myNewResource:view"))
   ```

## Best Practices

1. **Use the new RBAC system** (`rbac.ts`) for all new code
2. **Keep permissions granular** - separate view from manage
3. **Check permissions as early as possible** in your API routes
4. **Test permission boundaries** for each role
5. **Document role expectations** in UI tooltips and descriptions

## Testing

When testing permissions:

```typescript
import { teamRoleHasPermission } from "~/server/api/rbac";
import { TeamUserRole } from "@prisma/client";

describe("Permissions", () => {
  it("should allow admins to manage datasets", () => {
    expect(teamRoleHasPermission(TeamUserRole.ADMIN, "datasets:manage")).toBe(
      true
    );
  });

  it("should not allow viewers to manage datasets", () => {
    expect(teamRoleHasPermission(TeamUserRole.VIEWER, "datasets:manage")).toBe(
      false
    );
  });
});
```

## Future Enhancements

Potential improvements to the RBAC system:

1. **Custom Roles**: Allow orgs to define custom roles
2. **Resource-Level Permissions**: Fine-grained permissions per dataset/workflow
3. **Permission Groups**: Bundle permissions for common use cases
4. **Audit Logging**: Track permission checks and changes
5. **Time-Based Access**: Temporary elevated permissions
6. **Permission Inheritance**: More complex inheritance chains

## Troubleshooting

### "UNAUTHORIZED" errors

1. Check user's role in the team
2. Verify the permission is granted to that role in `TEAM_ROLE_PERMISSIONS`
3. Check if organization admin override should apply
4. Look for demo project or public share special cases

### Permission check not working

1. Ensure `ctx.permissionChecked` is set to `true`
2. Verify middleware is applied to the procedure
3. Check that the session contains a valid user

### Migration issues

1. Use `LEGACY_TO_RBAC_MAPPING` to find equivalent permissions
2. Update client code to use `hasPermission()` instead of `hasTeamPermission()`
3. Test each permission boundary after migration



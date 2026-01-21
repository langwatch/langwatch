# RBAC System

## Decision

Multi-tenant SaaS requires strict data isolation. We chose Organization → Team → Project hierarchy because:
- Organizations own billing and external integrations
- Teams scope access within organizations (departments, projects)
- Projects are the primary workspace unit

## Rules (Reviewer: Enforce These)

1. **Always use `checkPermissionOrThrow`** from `src/server/api/rbac.ts` - never write raw permission checks
2. **Never bypass with direct DB queries** - all data access must flow through RBAC
3. **Use the new system** (`rbac.ts`), not legacy `permission.ts` - backward compat only
4. **Client-side is advisory** - `hasPermission()` hides UI but server must re-check

## Quick Reference

| Role | Scope | Creates | Manages Members |
|------|-------|---------|-----------------|
| Org Admin | Organization | Teams | Yes (all) |
| Team Admin | Team | Projects | Yes (team) |
| Team Member | Team | Resources | No |
| Team Viewer | Team | Nothing | No |

Permission format: `resource:action` (e.g., `analytics:view`, `datasets:manage`)

# ADR-001: RBAC with Organization → Team → Project Hierarchy

**Status:** Accepted

## Context

LangWatch is a multi-tenant SaaS platform. We need strict data isolation between customers while supporting flexible team structures within organizations. Users need different permission levels depending on their role.

## Decision

Three-level hierarchy: Organization → Team → Project, with role-based permissions at each level.

| Role | Scope | Creates | Manages Members |
|------|-------|---------|-----------------|
| Org Admin | Organization | Teams | Yes (all) |
| Team Admin | Team | Projects | Yes (team) |
| Team Member | Team | Resources | No |
| Team Viewer | Team | Nothing | No |

Permission format: `resource:action` (e.g., `analytics:view`, `datasets:manage`)

## Rationale

- **Organizations** own billing and external integrations — natural boundary for enterprise customers
- **Teams** scope access within organizations — maps to departments or product lines
- **Projects** are the primary workspace — where traces and evaluations live

Alternative considered: flat user-project model. Rejected because it doesn't support enterprise org structures or granular team permissions.

## Consequences

**Rules to follow:**
1. Always use `checkPermissionOrThrow` from `src/server/api/rbac.ts` — never write raw permission checks
2. Never bypass with direct DB queries — all data access must flow through RBAC
3. Use the new system (`rbac.ts`), not legacy `permission.ts` — backward compat only
4. Client-side `hasPermission()` is advisory only — server must always re-check

**Key files:** `src/server/api/rbac.ts`, `src/hooks/useOrganizationTeamProject.ts`

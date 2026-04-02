---
name: code-review
description: "Project-level code review: check changed files against LangWatch codebase rules (IDs, multitenancy, layering, naming, SRP)."
context: fork
model: sonnet
user-invocable: true
argument-hint: "[branch or commit range, default: diff against origin/main]"
---

Review code changes against origin/main (or the provided range) and sign off on each rule below.

For each rule: **PASS** if no violations, or **FAIL** with every violation listed — one per line with `file:line`.

## Rules

1. **KSUID only — no uuid/nanoid.** The project uses `@langwatch/ksuid`. No imports of `uuid`, `nanoid`, or `crypto.randomUUID`.

2. **No foreign keys in Prisma migrations.** Prisma relations handle referential integrity. No `REFERENCES`, `FOREIGN KEY`, or `ADD CONSTRAINT.*FOREIGN` in `.sql` migration files.

3. **Prisma queries include projectId.** Every `findMany`/`findFirst`/`findUnique`/`update`/`delete` on project-scoped models must have `projectId` in the `where` clause. Skip: `User`, `Organization`, `OrganizationUser`, `Session`, `Account`, `VerificationToken`.

4. **ClickHouse queries include TenantId.** Every ClickHouse query must filter by `TenantId` in the WHERE clause.

5. **No TypeScript `any`.** No `: any`, `as any`, `<any>`, or `any[]` in added code. Ignore comments and eslint-disable lines.

6. **No hardcoded schema names in migrations.** No `"langwatch_db".` or other schema prefixes in `.sql` files. Use unqualified table names.

7. **Hooks don't return JSX.** Files matching `use*.ts` (not `.tsx`) must not return JSX. Hooks return state/callbacks only.

8. **No re-exports for backwards compatibility.** `export { X } from` or `export * from` shims are not allowed — update consumers directly. (New public API re-exports are fine.)

9. **Layer violations (route → service → repository).** Routes must not import from repositories. Services must not import another domain's repositories directly. Repositories must not import from services. See `src/server/app-layer/`.

10. **Repository/service method naming.** Repositories use `findAll`/`findById` (not `list*`/`get*`). Services use `getAll`/`getById` (not `find*`).

11. **Single Responsibility.** New files should not mix concerns (e.g. HTTP + business logic, data fetching + rendering). One primary export per file. Flag functions over ~100 lines.

## Output format

```
### 1. KSUID only (no uuid/nanoid) — PASS

### 2. No FK in migrations — FAIL
- FOREIGN KEY in `migrations/001_init.sql:45`
- ADD CONSTRAINT FOREIGN in `migrations/002_add.sql:12`

### 3. projectId in Prisma queries — FAIL
- `findMany` without projectId in `src/api.ts:33`

### 4. TenantId in ClickHouse queries — PASS

...
```

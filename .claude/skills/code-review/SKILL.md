---
name: code-review
description: "Project-level code review: grep changed files for KSUID violations, foreign keys, missing projectId/TenantId, TypeScript `any`, and other LangWatch codebase rules."
context: fork
model: sonnet
user-invocable: true
argument-hint: "[branch or commit range, default: diff against origin/main]"
---

Review changed files for LangWatch project rules. Each check is binary pass/fail.

## Step 1: Get the diff

```bash
RANGE="${ARGUMENTS:-origin/main...HEAD}"
git diff --name-only $RANGE -- '*.ts' '*.tsx' '*.prisma' '*.sql'
```

Save the file list. If empty, report "No changed files to review" and stop.

Then get the full diff content:

```bash
git diff $RANGE -- '*.ts' '*.tsx' '*.prisma' '*.sql'
```

## Step 2: Run checks

Create a TaskCreate for each check below. For each, grep the **added lines** (lines starting with `+`) in the diff. Report file:line for every violation found.

### Check 1: KSUID only — no uuid/nanoid

Grep added lines for imports of `uuid`, `nanoid`, `crypto.randomUUID`, or calls to `uuidv4`, `nanoid()`. The project uses `@langwatch/ksuid` with `generate()`.

- **Pass**: No uuid/nanoid imports or usage found
- **Fail**: List each violation

### Check 2: No foreign keys in Prisma migrations

Grep added `.sql` migration files for `REFERENCES`, `FOREIGN KEY`, `ADD CONSTRAINT.*FOREIGN`. Prisma relations handle referential integrity — raw SQL foreign keys are not allowed.

- **Pass**: No foreign key constraints in migrations
- **Fail**: List each violation

### Check 3: Prisma queries include projectId

Grep added lines in `.ts`/`.tsx` files for `prisma.*.findMany`, `findFirst`, `findUnique`, `findFirstOrThrow`, `findUniqueOrThrow`, `update`, `updateMany`, `delete`, `deleteMany` calls. Then check if the surrounding `where` clause includes `projectId`. Flag queries on project-level models that omit it.

Skip: queries on `User`, `Organization`, `OrganizationUser`, `Session`, `Account`, `VerificationToken` models (not project-scoped).

- **Pass**: All project-scoped queries include projectId
- **Fail**: List each suspicious query

### Check 4: ClickHouse queries include TenantId

Grep added lines for ClickHouse query strings (look for `SELECT`, `INSERT INTO` near ClickHouse table names or `clickhouse` client usage). Every query must have `TenantId` in the WHERE clause.

- **Pass**: All ClickHouse queries filter by TenantId
- **Fail**: List each violation

### Check 5: No TypeScript `any`

Grep added lines for `: any`, `as any`, `<any>`, `: Array<any>`, `: any[]`. Ignore comments and `// eslint-disable` lines.

- **Pass**: No `any` usage
- **Fail**: List each violation

### Check 6: No hardcoded schema names in migrations

Grep added `.sql` migration files for `"langwatch_db".` or other hardcoded schema prefixes. Use unqualified table names.

- **Pass**: No hardcoded schema names
- **Fail**: List each violation

### Check 7: Hooks don't return JSX

Grep added `.ts` files matching `use*.ts` (not `.tsx`) for JSX returns: `return <`, `return (` followed by `<`. Hooks must return state/callbacks, never JSX.

- **Pass**: No JSX in hook files
- **Fail**: List each violation

### Check 8: No re-exports for backwards compatibility

Grep added lines for patterns like `export { X } from "./old-location"` or `export * from` that look like re-export shims. These should be direct import updates at the consumer.

- **Pass**: No re-export shims
- **Fail**: List each suspicious re-export (use judgment — new public API re-exports are fine)

### Check 9: Hono routes go through services

Grep added Hono route files for direct repository imports or instantiation. Routes must call services, never repositories directly.

- **Pass**: No direct repository usage in route files
- **Fail**: List each violation

### Check 10: Repository/service method naming

Grep added repository files for methods named `list*` or `get*` (should be `findAll`/`findById`). Grep added service files for methods named `find*` (should be `getAll`/`getById`).

- **Pass**: Correct naming conventions
- **Fail**: List each violation

## Step 3: Summary

Output a table:

```
| # | Check                          | Result |
|---|--------------------------------|--------|
| 1 | KSUID only (no uuid/nanoid)    | PASS/FAIL |
| 2 | No FK in migrations            | PASS/FAIL |
| 3 | projectId in Prisma queries    | PASS/FAIL |
| 4 | TenantId in ClickHouse queries | PASS/FAIL |
| 5 | No TypeScript `any`            | PASS/FAIL |
| 6 | No hardcoded schema names      | PASS/FAIL |
| 7 | Hooks don't return JSX         | PASS/FAIL |
| 8 | No backwards-compat re-exports | PASS/FAIL |
| 9 | Hono routes use services       | PASS/FAIL |
| 10| Repo/service method naming     | PASS/FAIL |
```

List violations grouped by check. No commentary on passing checks.

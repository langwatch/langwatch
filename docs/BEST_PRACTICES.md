# Best Practices

## Testing

See `TESTING.md` for full hierarchy. Key points:

- **BDD first**: Write `.feature` specs before code
- **Outside-In TDD**: E2E → Integration → Unit
- **No "should"** in test names: `it("returns cached value")` not `it("should return...")`
- **One invariant per scenario**

## TypeScript

- **Exhaustive switches**: Always include `never` check in default case
- **Zod for shared types**: Define once, `infer` the TS type
- **Single export per file**: Thin files, single responsibility
- **Colocate interfaces**: Only extract to `types.ts` when shared across files

## React/Next.js

- **Page vs Component separation**:
  - Pages: routing, permissions (`src/pages/`)
  - Components: UI logic (`src/*/components/*.layout.tsx`)

## Service Layer

- **Wrapper methods**: Use `get` keyword for repository method passthrough, not `bind`

## File Organization

- hooks/ for hooks
- components/ for components
- pages/ for pages

## Git

- [Conventional Commits](https://www.conventionalcommits.org/)
- Link PRs to issues with `Closes #N`

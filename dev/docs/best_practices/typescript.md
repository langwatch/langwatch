# TypeScript

- **Exhaustive switches**: Always include `never` check in default case
- **Zod for shared types**: Define once, `infer` the TS type
- **Single export per file**: Thin files, single responsibility
- **Colocate interfaces**: Only extract to `types.ts` when shared across files
- **Service wrappers**: Use `get` keyword for repository passthrough, not `bind`
- **Named parameters over positional**: For functions with 2+ parameters, prefer object destructuring. Makes call sites self-documenting and parameter order irrelevant.

  ```typescript
  // Bad: positional parameters
  runScenario(scenarioId, target, setId)

  // Good: named parameters via object destructuring
  runScenario({ scenarioId, target, setId })
  ```

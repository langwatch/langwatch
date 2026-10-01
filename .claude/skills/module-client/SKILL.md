---
name: module-client
description: "Create or use a <name>-client package (modules/<name>/client): the typed tRPC hooks another module's browser reads. Use when someone says 'read another module's data in the browser', 'prompt-client', 'dataset-client', 'a client package', 'createModuleApi', 'ContractApiMap', 'derived tRPC client', 'browser wire', 'httpLink', 'request batching', 'the tRPC client in the browser', 'AppRouter in the UI', or 'can my screen call another module's procedure'. Teaches the record (ARCHITECTURE.md section 2 wire row, 3.4, 10)."
user-invocable: true
argument-hint: "<module name or data question>"
---

# `<name>-client`: modules share data, not code

Read `dev/docs/ARCHITECTURE.md` §2 (the Web row), §3.4 ("No kits; data through
clients") and §10 (the cache and wire rulings). Exemplars:
`modules/prompt/client` and `modules/dataset/client` (about 30 lines of source
each). A module with tRPC procedures gets `modules/<name>/client`, package
`@langwatch/<name>-client`. A module nothing else reads has none
(integration, §3).

## The wire, in one picture

```
contract (<name>Trpc)  --ContractApiMap-->  createModuleApi()  -->  hooks (useQuery, useMutation, useUtils)
                                                       |
                  @langwatch/browser owns the one browser client: httpLink + SSE link + query client
```

- `@langwatch/api/web` derives the typed client from the contract's declarations.
- `@langwatch/browser` owns the transport (one client per application,
  `packages/browser/src/transport.ts`), the SSE subscription link and the
  query client. Only a client package and a screen's `behavior/` import it.
  A design-system component fetches nothing.
- The browser calls no REST.

## Rules that matter

1. **Derived, never hand-written, never `AppRouter`** (ADR-130). Types come from
   `ContractApiMap<typeof <name>Trpc>`; inputs and outputs are never `any`.
2. **A client holds only the hooks `createModuleApi` derives, plus at most a
   few thin convenience hooks.** Never a component.
3. **It imports its own contract and `@langwatch/api/web`, nothing else**: no
   other client, no browser package, no `@langwatch/browser`, no `browser-host`. A hook that
   combines two modules lives in the screen that needs it.
4. **One call per request over `httpLink`.** Each answer carries its own
   status, session version and schema hash. The record rules batching out
   (§10, "No request batching"): do not reach for `httpBatchLink`, and do not
   build a client that assumes batched responses. The server refuses batches.
5. **Caching is the contract's and the kernel's, not the client's.** A read is
   cached in memory and in the sealed IndexedDB mirror, goes stale on an SSE
   hint, and never takes a per-read `staleTime`. A cursor-backed read carries
   its cursor in the key. A query never returns a credential.
6. **One entity, one key.** Detail reads take the opaque id plus tenant scope
   (`projectId` / `organizationId`); hints never enter a key (§10.2).
7. **A procedure another module owns, that you still call, is a borrowed
   one-off.** It sits in a `BorrowedProcedures` type that says so, until that
   module's contract declares it. Treat it as debt, not a pattern.

## Worked example

```ts
// modules/prompt/client/src/prompt-client.ts
import { type ContractApiMap, createModuleApi, type ModuleApi, type OutputsFromMap }
  from "@langwatch/api/web";
import type { promptTagTrpc, promptTrpc } from "@langwatch/prompt-contract";

type PromptApiMap = ContractApiMap<typeof promptTagTrpc> & ContractApiMap<typeof promptTrpc>;
export const promptClient: ModuleApi<PromptApiMap> = createModuleApi<PromptApiMap>();
export type PromptOutputs = OutputsFromMap<PromptApiMap>;   // PromptInputs likewise
```

`src/index.ts` re-exports the three names and nothing else. `package.json`
has `main` and one `exports["."]`, dependencies `@langwatch/api` and
`@langwatch/prompt-contract` only. A consuming browser package lists
`@langwatch/prompt-client` and calls `promptClient.<proc>.useQuery(...)`
inside its own `behavior/` hook; its declaration still names its own api
(`.withApi(...)`), so the contract's cache policy reaches the browser.

To add one: copy `modules/dataset/client`, rename, point `ContractApiMap` at
every `*Trpc` object the contract exports, run `pnpm sync:references`
(new workspace package) and `pnpm generate:modules` if the catalogue changed.
Not every module with a contract has landed a client; today api-key, dataset,
evaluator, prompt and scenario have one.

## Traps

- **Importing another module's `-browser` package for its hook.** It is closed.
  Use its client.
- **Putting a component in a client** because two modules want it. It goes to
  `design-system` taking props or a query result, or the owner lends it by token.
- **Copying server data into `useState` or a store.** It stays in React Query
  (`query-data-in-state` lint, ADR-169).
- **Calling a procedure by path from a typed hook's key.** A surface too wide
  for a typed hook uses the shell's `UiRpc`; never re-enter the cache under the
  key being resolved (§10).
- **`@langwatch/browser` still says "batching" in §2.** The record contradicts itself
  there; the `No request batching` ruling (§10) is the newer one.
- Host-service wiring, lending and entitlement are not here: the future
  `module-dependencies` skill. Where the hook is used: `browser-module`.

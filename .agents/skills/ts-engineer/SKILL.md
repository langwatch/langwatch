---
name: ts-engineer
description: >
  Use tslsp-cli (@0xdeafcafe/tslsp-cli) for type-aware TS/JS navigation and refactoring. Always use for identifier work in .ts/.js files under tsconfig.json.
allowed-tools: Bash(npx:*)
---

# TypeScript Engineer - tslsp-cli

Use `tslsp-cli` for type-aware operations on TypeScript/JavaScript. **Never use grep/edit/mv for identifiers** - they miss re-exports, aliases, and semantic relationships.

## Install
```bash
npm i -g @0xdeafcafe/tslsp-cli
# or project-local
pnpm add -D @0xdeafcafe/tslsp-cli

# Verify
npx --no-install @0xdeafcafe/tslsp-cli --version
```

## The Golden Rule
**Before you grep/edit/mv anything in TS/JS code, ask: "Is this an identifier?" If yes → tslsp-cli. No exceptions.**

This includes: functions, classes, interfaces, types, variables, constants, parameters, properties, enum members, namespace imports.

Text tools (grep, sed, edit) are **type-blind** and will silently miss re-exports, alias imports, dynamic imports, type-only imports, namespaced imports.

## When to Use
| Task | tslsp-cli | grep/edit |
|------|-----------|-----------|
| Find definition | ✅ | ❌ text lies |
| Find references | ✅ | ❌ misses re-exports |
| Rename symbol | ✅ | ❌ breaks imports |
| Move/rename file | ✅ | ❌ breaks imports |
| Check types | ✅ | ❌ text-blind |
| Implement interface | ✅ | ❌ needs types |
| Organize imports | ✅ | ❌ misses duplicates |
| String literals | ❌ | ✅ |
| Non-TS files | ❌ | ✅ |
| No tsconfig.json | ❌ | ✅ |

## Core Commands

Always use: `npx --no-install @0xdeafcafe/tslsp-cli` (prevents silent version changes)

### Find
```bash
tslsp-cli find-symbol User                  # workspace search
tslsp-cli find-symbol User --kind class    # filter by kind
tslsp-cli find-symbol stamp --container Util  # filter by container
```

### Navigate
```bash
tslsp-cli definition     --symbol User       # where defined
tslsp-cli references     --symbol User       # all usages
tslsp-cli references     --symbol User --summary  # compact output
tslsp-cli implementation --symbol IGreeter  # interface impls
tslsp-cli type-definition --symbol someValue
```

### Inspect
```bash
tslsp-cli hover         --symbol User        # type + JSDoc
tslsp-cli hover         --symbols User,Account,Session  # batch
tslsp-cli outline       src/api.ts           # file structure
tslsp-cli outline       --depth 0 src/big.ts  # top-level only
tslsp-cli call-hierarchy --symbol fn --direction incoming  # callers
```

### Refactor
```bash
tslsp-cli rename          --symbol User --new-name Account --dry-run  # ALWAYS dry-run first
tslsp-cli rename          --symbol User --new-name Account
tslsp-cli rename-file     src/old/User.ts src/users/User.ts --dry-run
tslsp-cli code_action --file src/api.ts   # list quick fixes/refactors/import actions
```

### Verify
```bash
tslsp-cli diagnostics --file src/api.ts     # check file
tslsp-cli diagnostics 'src/**/*.ts'          # check pattern
tslsp-cli diagnostics                       # check all open files
```

## Position Format
```bash
tslsp-cli references --symbol User            # by name (preferred)
tslsp-cli references --file src/x.ts --line 42 --symbol User  # by location
```
Column is **zero-based LSP position** (byte offset, not character count).

## Batching
All read-only commands accept multiple targets:
```bash
tslsp-cli find-symbol User Account Session
tslsp-cli references --symbols add,sum,double
tslsp-cli outline src/api.ts src/db.ts
tslsp-cli diagnostics 'src/api/**/*.ts'
```
Saves tokens and round-trips. Output labeled by name, empty results dropped.

## Tips
1. **--dry-run MANDATORY** for renames
2. **Use --summary** on popular symbols to avoid token explosion
3. **Batch aggressively** - one call with 10 symbols > 10 calls with 1
4. **Always verify** with diagnostics after edits

## References
- GitHub: https://github.com/0xdeafcafe/tslsp-cli
- TS Language Server: https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API
- LSP: https://microsoft.github.io/language-server-protocol/

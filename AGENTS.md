# LangWatch Agent Skills

This file documents the custom skills available for agents working on the LangWatch codebase.

## Enabled Skills

### Code Engineering Skills

#### ts-engineer
- **Path**: `.agents/skills/ts-engineer/SKILL.md`
- **Purpose**: Type-aware TypeScript/JavaScript navigation and refactoring using `tslsp-cli`
- **Features**:
  - Symbol search and discovery
  - Definition and reference lookups
  - Safe symbol renaming with `--dry-run`
  - File moves with automatic import updates
  - Type diagnostics
  - Import organization
  - Batch operations for efficiency
   - **Prerequisite**: `npm i -g @0xdeafcafe/tslsp-cli` or `pnpm add -D @0xdeafcafe/tslsp-cli`
- **When to use**: Any identifier work in `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs` files under a `tsconfig.json`

#### go-engineer
- **Path**: `.agents/skills/go-engineer/SKILL.md`
- **Purpose**: Type-aware Go navigation and refactoring using `gopls` CLI
- **Features**:
  - Definition and reference lookups
  - Implementation finding
  - Symbol renaming
  - Type checking and diagnostics
  - Import organization
  - Workspace symbol search
- **Prerequisite**: `go install golang.org/x/tools/gopls@latest`
- **When to use**: Any identifier work in `.go` files in a Go module or GOPATH workspace

## Usage

To use these skills in the LangWatch repository:

```bash
# For TypeScript work
npx --no-install @0xdeafcafe/tslsp-cli <command> [args...]

# For Go work
gopls <command> [args...]
```

Or reference them in prompts to the agent:
- "Use the ts-engineer skill to find all references to this function"
- "Use the go-engineer skill to rename this symbol safely"

## Skill Directory Structure

```
.
  .agents/
    skills/
      go-engineer/
        SKILL.md    # Go engineering skill
      ts-engineer/
        SKILL.md    # TypeScript engineering skill
```

## Golden Rules

### For TypeScript/JavaScript
**Always use `tslsp-cli` for identifier work.** Never use grep/edit/mv for:
- Finding definitions
- Finding references
- Renaming symbols
- Moving files
- Checking types

Text tools are type-blind and will miss re-exports, alias imports, and other semantic relationships.

### For Go
**Always use `gopls` for identifier work.** Never use grep/edit/mv for:
- Finding definitions
- Finding references
- Renaming symbols
- Finding implementations
- Checking types

## Installation

For agents working on this repository:

### TypeScript Setup
```bash
npm i -g @0xdeafcafe/tslsp-cli
# or project-local
pnpm add -D @0xdeafcafe/tslsp-cli
```

### Go Setup
```bash
go install golang.org/x/tools/gopls@latest
```

## References

- [gopls documentation](https://go.dev/gopls)
- [tslsp-cli GitHub](https://github.com/0xdeafcafe/tslsp-cli)
- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)

---
name: go-engineer
description: >
  Use gopls CLI (golang.org/x/tools/gopls) for type-aware Go navigation, refactoring, and analysis. Always use for identifier work in .go files.
---

# Go Engineer - gopls CLI

Use `gopls` for type-aware operations on Go code. **Never use grep/edit/mv for identifiers** - they miss re-exports, aliases, and semantic relationships.

## Install
```bash
go install golang.org/x/tools/gopls@latest
gopls -version  # verify
```

## When to Use
| Task | gopls | grep/edit |
|------|-------|-----------|
| Find definition | ✅ | ❌ misses re-exports |
| Find references | ✅ | ❌ misses aliases |
| Rename symbol | ✅ | ❌ breaks imports |
| Check types | ✅ | ❌ text-blind |
| Implement interface | ✅ | ❌ needs type analysis |
| String literals | ❌ | ✅ |
| Non-Go files | ❌ | ✅ |

**Rule:** If it's a Go identifier (function, type, var, const, method, package), use gopls.

## Commands

### Navigation
```bash
gopls definition       file.go:line:col    # where defined
gopls references      file.go:line:col    # all usages
gopls implementation  file.go:line:col    # interface impls
gopls type_definition file.go:line:col    # type origin
gopls hover          file.go:line:col    # signature + docs
```

### Workspace
```bash
gopls workspace/symbol User              # fuzzy search
gopls workspace/symbol User --kind func  # filter by kind
gopls workspace/packages                  # list packages
```

### Refactor
```bash
gopls rename -d         file.go:line:col NewName             # ALWAYS preview first
gopls rename -w         file.go:line:col NewName             # apply edits
gopls organize_imports file.go            # fix imports
```

### Diagnostics
```bash
gopls diagnostics     file.go              # check file
gopls diagnostics     pkg/                 # check package
gopls diagnostics                        # check workspace
```

## Position Format
`file.go:line:column` - 1-indexed, column is byte offset (not character count)
`file.go:#offset` - byte offset from start (0-indexed)

## Workflows

### Safe Rename
```bash
gopls references src/pkg/utils.go:25:6       # review impact
gopls rename -d src/pkg/utils.go:25:6 NewName
gopls rename -w src/pkg/utils.go:25:6 NewName
gopls diagnostics src/pkg/                   # verify
```

### Add Interface Method
```bash
gopls definition src/api/Processor.go:10:1    # find interface
gopls implementation src/api/Processor.go:10:1  # find impls
# Add method to each implementation
gopls diagnostics src/api/                   # verify
```

## Tips
1. **Always use `-d` to preview a rename before `-w` applies it**
2. **Verify with diagnostics** after edits
3. Column numbers are **byte offsets**, not character counts
4. gopls uses `go` command from PATH - ensure correct Go version
5. CLI is experimental - prefer editor integration (VS Code, Vim, Emacs)

## References
- Docs: https://go.dev/gopls
- Source: https://cs.opensource.google/go/x/tools/gopls
- LSP: https://langserver.org

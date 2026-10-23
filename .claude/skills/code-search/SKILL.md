---
name: code-search
description: "Pick the right tool to find code in this repository: ripgrep when you know the word, sgrep (search by meaning) when an index is ready, ripgrep while an index builds, gopls and tslsp for exact references. Use when someone says 'find where', 'search the code', 'which file handles', 'grep for', 'sgrep', 'semantic search', 'search by meaning', 'index the repo', 'is the index ready', 'code search', or before sweeping an unfamiliar area of the tree."
user-invocable: true
argument-hint: '[status <dir> | query <dir> "<question>" | index <dir>]'
---

# Code search

Measured on this repository, 2026-10-14 (busy host, so times are rough):

| Tool                 | Setup                      | Per search               | Finds the right code                 |
| -------------------- | -------------------------- | ------------------------ | ------------------------------------ |
| `rg`                 | none                       | 0.06-0.8 s               | given the word, in non-ignored files |
| `git grep`           | none                       | 0.07-2.4 s               | same; tracked files only             |
| `grep -r`            | none                       | 18-34 s                  | same, but walks every `node_modules` |
| sgrep, no index      | n/a                        | won't run                | n/a                                  |
| sgrep, indexed       | `modules/` 26 min, ~500 MB | 0.1-0.3 s                | about half, by meaning               |
| gopls `references`   | none                       | 4-15 s                   | exact                                |
| `rush ts references` | none                       | ~30 s cold, then seconds | exact; needs file and line           |

## Which tool

```
know the identifier?            ── yes ──▶ rg -n -w <identifier> <dir>
know a literal string or code?  ── yes ──▶ rg -n -F '<string>' <dir>
        │ no
        ▼
sgrep.sh status <dir>  ── ready ──▶ sgrep.sh query <dir> "<question>"
        │                              then confirm with rg on the names it found
        │ building / none
        ▼
guess two or three likely words ──▶ rg -n -i -e a -e b <dir>
need every caller of a Go symbol, exactly? ──▶ gopls references file.go:line:col
```

- **ripgrep first.** It needs nothing and never misses a literal match in the files it searches
  (everything not excluded by `.gitignore` or `.rgignore`; see below). Never `grep -r`.
  Give `rg` an explicit path: with no path and no terminal it reads stdin and hangs.
- **sgrep only when the index is ready.** A query against a missing or half-built index is
  wrong or empty, so the helper refuses (exit 3) and you use `rg`. sgrep answers roughly half
  the "where is X done" questions; treat its hits as leads and confirm them with `rg`.
- **While an index builds, use `rg`.** Don't wait for it.
- **Exact references:** `gopls references` for Go. `rush ts references --file F --line N --symbol S`
  for TypeScript, and `rush ts rename` / `rename-file` for renames and moves. Always give the file
  and line; `find_symbol` loads every project and is slow here.
- sgrep skips tests, generated and vendored files itself; pass `-t` to include tests.
- `rg` skips the generated files listed in the root `.rgignore` (lockfiles, snapshots, generated
  clients and READMEs). Searching for something that only lives there, such as a handled-error
  code in `codes.generated.ts`? Add `--no-ignore-dot`. After adding a `linguist-generated` line
  to `.gitattributes`, regenerate `.rgignore` with the command in its header.

## The helper

`.claude/skills/code-search/sgrep.sh` wraps sgrep so you don't handle its embedding server:

| Command                                                       | Does                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| `sgrep.sh status modules/trace`                               | `ready: <dir>` (exit 0), or `building` / `none` (exit 3) |
| `sgrep.sh query modules/trace "where spans are written" -n 5` | search the index covering that path; exit 3 = use `rg`   |
| `sgrep.sh index modules/trace`                                | build an index in the background; prints the log path    |
| `sgrep.sh stop`                                               | stop the embedding server it started                     |

Extra arguments after the question go to sgrep (`-n 5`, `-t`, `--profile fast`, `--json`).
Index one area (`modules/<name>`, `services/<name>`), not the root: the whole tree takes
2-3 hours. A Go service of ~300 files takes under two minutes.

The index lives in `~/.sgrep` (outside the checkout), so git never sees it. An index belongs to
one absolute path: a worktree does not share the main checkout's, so `status` there says `none`.
Indexes stay until removed (`modules/` is about 500 MB); `sgrep.sh stop` stops the server only.
`sgrep list` shows them; `cd <dir> && sgrep clear` deletes one.

## Install

`brew install xiaoconstantine/tap/sgrep` (after `brew trust --formula xiaoconstantine/tap/sgrep`).
If brew refuses over outdated Command Line Tools, download the release tarball named in the
formula, check its sha256 against the formula, and put the binary at `.bin/sgrep/sgrep`.
Needs `llama-server` (`brew install llama.cpp`); the helper downloads the model on first index.

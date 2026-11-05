# ADR-184: Isolated jsdom test files share a worker instead of starting a process each

**Date:** 2026-10-22

**Status:** Proposed

## Context

A jsdom suite that isolates its files (`isolate: true` for the files that mock
modules, `isolate: "all"` for every file) runs each isolated file on the forks
pool in a process of its own. Vitest reports the cost as "environment": 29 to
31% of the trace UI suite (`modules/trace/browser`, 361 files, 185 isolated)
and 18 to 20% of the UI app (`apps/ui`, 57 files, all isolated).

Measured on this machine, almost none of that is building a window:

| step, Node 24, jsdom 30                   | CPU time |
| ----------------------------------------- | -------- |
| `import("jsdom")` in a fresh process      | ~700 ms  |
| first `new JSDOM()` after that            | ~60 ms   |
| every later `new JSDOM()` in that process | ~6 ms    |

So the cost is loading jsdom's code, again, in every new process. Building or
resetting a window is noise next to it.

With isolation off, Vitest 5 already keeps a worker across files and sets the
environment up once, when the worker starts. Its summary still shows a large
"environment" share there because it copies the worker's one setup time onto
every file it runs (`state.durations.environment = _environmentTime`), so that
figure counts one setup many times.

Options we tried:

1. **One window per worker, reset between files** (replace the document,
   clear timers, listeners, storage, cookies, history, delete the globals a
   file added). A reset can only beat `new JSDOM()`'s ~6 ms, and only inside a
   worker that lives across files. Isolated files never get one, because the
   forks pool stops the process after each. Shared files already get one, with
   no rebuild. There is nothing for a reset to save, so we didn't ship it.
2. **Node startup snapshots** (`node --build-snapshot`) with jsdom loaded.
   The snapshot script may load only Node's built-in modules, so jsdom has to
   be bundled into one CommonJS file. V8 builds snapshots without
   `SharedArrayBuffer`, which `webidl-conversions` reads on load, so it needs
   a stand-in. css-tree loads its data through `createRequire`, so that data
   has to be inlined by hand, and two `__dirname` paths have to be rewritten.
   After all that the build still fails: `global handle not serialized`, a
   native object one of jsdom's dependencies creates on load. Even with a
   working snapshot, Vitest starts its workers with `child_process.fork` on
   its own ESM entry, and its jsdom environment imports jsdom from
   `node_modules`, so it would also need a custom pool worker and a custom
   environment. Not workable today.
3. **happy-dom.** On the UI app it used about 15% less CPU than jsdom (144s
   against 170s) and failed one test, in the Vite config loader. On the
   trace UI suite, the first 722 tests passed before the run hit the
   machine's 30-minute limit. It still pays a process and a module load per
   isolated file, so it saves far less than option 5, and it isn't a drop-in
   swap. We don't switch any package over.
4. **Cloning a window, or forking a warm process.** JavaScript can't clone a
   window: `structuredClone` refuses functions and DOM objects, and jsdom has
   no API to copy a window's state. Node has no `fork(2)`:
   `child_process.fork` starts a new Node process, not a copy of the current
   one, and a real `fork(2)` of a process running V8's threads isn't safe.
5. **Vitest's `vmForks` pool for the isolated files.** One worker per lane
   loads jsdom once. Each file gets a fresh `vm` context with its own module
   registry and a new jsdom window (the ~6 ms step), and the worker moves on to
   the next file.

## Decision

We will let a suite run its isolated files on `vmForks` with
`isolateIn: "vm-context"` in `defineModuleVitestConfig`. The files that share
modules stay on forks with isolation off, as before. The trace UI suite and the
UI app opt in. Every other suite keeps a process per isolated file until it
opts in.

A file that can't run in a `vm` context keeps a process of its own: the suite
lists it in `needsOwnProcess` and says why, and any file that asks for
`@vitest-environment node` gets one without being listed. Each `vmForks` worker
restarts once its heap passes 1 GB after a file (`vmMemoryLimit`), since a
context keeps a file's module graph until a full GC.

Fast mode off (`LANGWATCH_VITEST_FAST=0`) keeps a process per isolated file.

## Rationale / Trade-offs

Isolation stays just as strict: every isolated file still starts from a fresh
module registry and a fresh window, which neither a reset nor a shared worker
gives. What changes is where the file runs, and two things a `vm` context does
differently:

- **Node's built-in objects come from another realm.** A native module that
  checks its arguments against its own realm's `String` or `RegExp`, such as
  Vite's bundler, rejects them. Files that load Vite go in `needsOwnProcess`.
- **The window is the context's global.** `window.location` can't be
  redefined, so `vi.stubGlobal("location")` and
  `vi.spyOn(window, "location", "get")` throw. Those files go in
  `needsOwnProcess` as well.

A file that leaves async work running after its last test (an import still in
flight) can now show up as an unhandled error, where before the process was
stopped under it. That's a real leak in the test, and the fix belongs in the
test.

## Consequences

- The trace UI suite and the UI app use roughly a third of the CPU they did
  (numbers in the PR). Their isolated files show in the output under
  `isolated`, and the listed ones under `own-process`.
- `testing-speed.md` now says the forks pool is the default, not the only
  pool: isolated files may run on `vmForks`.
- A new isolated file that stubs `location` or loads a native module fails
  with a clear error under `vm-context`. The fix is one line in
  `needsOwnProcess`.

## References

- Spec: `specs/ci/test-isolation-in-vm-contexts.feature`
- Builds on the split in `specs/ci/test-isolation-by-mocking.feature`
- https://vitest.dev/guide/improving-performance#test-environments

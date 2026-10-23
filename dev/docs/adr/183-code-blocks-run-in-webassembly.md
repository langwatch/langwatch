# ADR-183: Code blocks run in WebAssembly inside the engine

**Date:** 2026-10-22

**Status:** Proposed

## Context

A workflow's code block runs Python its author wrote. nlpgo runs it today as a
`python3` subprocess per execution, which ties the engine to a Python
installation in every image (the distroless Python base, a curated library set
built against its ABI), and leaves the isolation of one execution from the
engine and from other executions to operating-system process boundaries. In
Cloud that boundary is a Lambda function per project; a self-hosted install
has one engine for every project.

We want the engine to be the only thing that runs, with the isolation of user
code expressed in the engine itself, the same way in Compose, Helm and Lambda.

## Decision

We will run code blocks in a WASI build of CPython, executed by wazero (a
pure-Go WebAssembly runtime) inside the nlpgo process, selected by
`NLPGO_ENGINE_CODE_BLOCK_RUNTIME=wasm`. The subprocess runtime stays the
default until the wasm runtime has run in production.

- **One instance per execution.** `python.wasm` is compiled once per process;
  each execution instantiates it afresh with its own linear memory, capped
  (512 MiB by default, `NLPGO_ENGINE_CODE_BLOCK_MEMORY_MIB`).
- **Mounts, not a filesystem.** The guest sees the standard library (served
  from memory, read-only), the runner and its stand-ins (`/runner`,
  read-only), and its own run directory (`/work`). `/work` is held in engine
  memory (`codeblock/workfs.go`), never on the host disk, with no links of any
  kind and a budget of 64 MiB, 4096 entries, 256 open files (counted across
  every mount, the read-only ones too), 255-byte names and 4096-byte paths. Files are stored and charged in 64 KiB chunks, so the budget counts
  what the engine holds; a deleted file still open keeps its charge until the
  last handle closes. The runner's
  result is read from it. A host directory mount was rejected: wazero refuses
  absolute link targets but follows relative ones. Nothing else on the host
  exists for the guest. It receives no host environment variable; the run's own
  sandbox credential is the only one injected.
- **No processes, threads or sockets.** WASI preview 1 has none. Outbound
  HTTP is a host call: the guest writes one framed request on its stdout and
  reads one reply on its stdin (`codeblock/bridge.go`), and the engine
  performs it under the HTTP block's egress policy (`pkg/ssrf`). `requests`
  and `httpx` are stand-ins built on that call, covering the verb helpers,
  sessions/clients and responses.
- **Budgets.** Concurrent runs share a memory budget
  (`NLPGO_ENGINE_CODE_BLOCK_TOTAL_MEMORY_MIB`, 4096 by default) held by the
  executor (the engine builds one). A run is charged its memory ceiling,
  `/work`, unread replies, twice the result cap and twice its request, capped
  at 16 MiB. It is admitted before its request is encoded, holds the charge
  until its result is collected, and waits for room within its own deadline.
  A result is walked before it is decoded and refused past 100,000 values or
  128 levels. A budget below one run's charge refuses to start. Host calls are bounded per run: 64
  requests, 256 failing calls and 32 MiB of unread replies stop the run, and
  the result it hands back is capped at 32 MiB.
- **Egress.** Code blocks use the HTTP block's policy but never reach private
  or loopback addresses unless `NLPGO_ENGINE_CODE_BLOCK_ALLOW_LOCAL_EGRESS` is
  set, whatever `BLOCK_LOCAL_HTTP_CALLS` says: a code block is arbitrary code,
  not a configured request. The HTTP block's allow-listed hosts skip the
  address checks, so code blocks do not inherit them. DNS lookups for the policy end with the request.
- **Time is the engine's.** A run is stopped at its deadline wherever it is.
  `time.sleep` and the asyncio event loop wait through the engine, so a
  sleeping run also ends at its deadline.
- **JavaScript runs on the same substrate, always.** A code node whose
  `language` parameter is `javascript` runs on QuickJS (`quickjs-ng`, WASI
  build), whatever runtime Python uses, from `NLPGO_ENGINE_QUICKJS_WASM`. User
  code is an ES module whose default export takes the inputs as one object.
  `fetch` and timers go through the same host bridge and deadline. A trivial
  run takes a few milliseconds. New code nodes default to JavaScript.
- **TypeScript is JavaScript with its types erased, never checked at run time.**
  A `typescript` node is transformed by esbuild's Go API in the engine (no
  type-checking: only code that does not parse is refused, as a SyntaxError at
  its line), then runs on QuickJS like JavaScript. A traceback names the
  TypeScript line, read back through esbuild's source map. Types are checked in
  the Studio editor as the author writes, against the node's contract.
  esbuild parses outside the sandbox and its stack grows with nesting (about
  2 to 4 KiB per level), so TypeScript source is capped at 64 KiB and parsed
  only after the run is admitted; the worst nesting that fits stays near
  200 MiB of stack, inside the run's admitted share.
- **The runtime is an artifact, pinned by checksum.** CPython 3.14 for WASI
  (`brettcannon/cpython-wasi-build`), fetched and its stdlib precompiled by
  `services/nlpgo/scripts/fetch-python-wasm.sh`, shipped in the image at
  `NLPGO_ENGINE_PYTHON_WASM_HOME`; QuickJS 0.17.0 by
  `services/nlpgo/scripts/fetch-quickjs-wasm.sh`.

## Rationale / Trade-offs

A WebAssembly instance is a capability boundary: the guest can do only what
the host wires in, and we wire in very little. That makes the isolation
property local to one Go package and testable in a unit test, rather than a
property of the container, the chart's security context and the cloud
platform together. It also removes the reason the Cloud engine needs a
function per project, which we can revisit once this runtime is the default.

What it costs:

- **Native extensions do not load.** Pure-Python code and the standard library
  work; packages with compiled extensions (pydantic v2, numpy) do not, unless a
  WASI build exists. The subprocess runtime's curated set is the measure of
  what moves: `requests` and `httpx` are covered by stand-ins, the LangWatch
  SDK and pydantic are not yet.
- **Start-up.** A trivial execution takes roughly twice the subprocess's time
  (about 0.2 s against 0.08 s on a loaded laptop). Pre-initialising the
  interpreter (a Wizer-style snapshot of an imported runner) is the known
  lever if this matters.
- **The compiler is in the trust base.** wazero compiles guest code to native
  code; a compiler defect could matter in a way an interpreter's would not.
  The per-project Lambda in Cloud stays as a second boundary until the runtime
  has a production record.

We considered Starlark (sandboxed by design, but no classes, which nearly all
existing code blocks use) and per-execution operating-system users (a strong
boundary, but it needs privileged capabilities in every deployment and leaves
the Python installation in place).

## Consequences

- Operators opt in with one variable; the image carries both runtimes.
- The code-block suite runs on both runtimes in CI
  (`NLPGO_CODEBLOCK_TEST_RUNTIME=wasm`).
- Once the wasm runtime is the default, the image can drop its Python base and
  the curated library set.
- Existing nodes have no `language` and stay Python; only new nodes start in
  JavaScript.

## References

- `services/nlpgo/app/engine/blocks/codeblock/wasm.go`, `bridge.go`, `wasmsite/`,
  `runner.mjs`
- `specs/nlp-go/code-block.feature`, rule "The wasm runtime runs each execution
  in its own WebAssembly instance", "JavaScript code blocks run on QuickJS
  inside the engine" and "TypeScript code blocks run as JavaScript with their
  types erased"

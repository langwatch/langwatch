Feature: Code block — execute user Python with isolated subprocess and structured I/O
  The code block runs arbitrary Python written by the workflow author. nlpgo
  spawns a Python subprocess (helper script bundled in the container) for each
  invocation, marshals declared inputs as JSON over stdin, and reads declared
  outputs as JSON over stdout. Sandboxing matches today's Python NLP behavior
  (process isolation; no syscall restrictions) so existing customer code keeps
  working byte-for-byte.

  See _shared/contract.md §7.

  # The feature-parity checker (packages/architecture-enforcer/src/check-feature-parity.ts) has a
  # Go walker, so scenarios here bind to Go tests via a `@scenario` comment above
  # the test func. The execution-semantics scenarios are bound to
  # services/nlpgo/tests/integration (code_block_spec_test.go and
  # code_block_realistic_test.go).
  #
  # Read the Given lines literally. A scenario that names
  # NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS is covered through the environment;
  # one that names "the code executor's configured ceiling" is covered by
  # handing the executor that ceiling directly, which is the same value one
  # step later in the same wiring. The distinction matters because only the
  # first kind proves the variable is read at all.
  #
  # The scenarios still tagged @unimplemented describe behavior not yet built
  # (per-node stdout/stderr on the streamed execution event) or not yet
  # exercised end to end over HTTP, not a binding gap.

  Background:
    Given nlpgo is listening on :5562
    And a Python 3.12+ interpreter is available on PATH inside the container

  Rule: Inputs are passed by name and outputs are read by name

    @unit
    Scenario: a code block with two inputs and one output runs and returns the output
      Given a code node declaring inputs ["a", "b"] of type int and output "sum" of type int
      And the code body:
        """
        def execute(a: int, b: int) -> dict:
            return {"sum": a + b}
        """
      When the engine invokes the node with {"a": 2, "b": 3}
      Then the node's output equals {"sum": 5}
      And the node's status is "success"

    @unit
    Scenario: a missing declared output is reported as an error
      Given a code node declaring outputs ["sum", "diff"]
      And the code body returns only {"sum": 5}
      When the engine invokes the node
      Then the node's status is "error"
      And the error message contains "missing_output: diff"

    @unit
    Scenario: an extra undeclared output is dropped silently
      Given a code node declaring output "sum"
      And the code body returns {"sum": 5, "scratch": [1,2,3]}
      When the engine invokes the node
      Then the node's output equals {"sum": 5}

  Rule: stdout and stderr are captured for observability

    @integration @unimplemented
    Scenario: stdout from user code is attached to the node's execution event
      Given a code node whose body prints "hello-stdout" then returns {"ok": true}
      When I POST /go/studio/execute and read the SSE stream
      Then the node's "execution_state_change" event includes stdout containing "hello-stdout"

    @integration @unimplemented
    Scenario: stderr from user code is attached to the node's execution event
      Given a code node whose body writes "hello-stderr" to stderr then returns {"ok": true}
      When I POST /go/studio/execute and read the SSE stream
      Then the node's "execution_state_change" event includes stderr containing "hello-stderr"

  # The exception class belongs in the words, never in error.type. error.type is
  # a closed set the product writes customer copy against; a Python class name
  # is whatever the customer's code raised, so putting one there gave the client
  # a code it had never heard of and no copy to show for it.
  Rule: Exceptions are surfaced as structured errors with the traceback

    @integration
    Scenario: ZeroDivisionError aborts the node and the workflow with the traceback intact
      Given a code node whose body computes 1/0
      When I POST /go/studio/execute_sync
      Then the response.result.status is "error"
      And the error.node_id matches the code node id
      And the error.type is "code_runner_error"
      And the error.message names ZeroDivisionError and contains "division by zero"
      And the error.traceback contains "ZeroDivisionError: division by zero" and the offending user-code frame

    @integration
    Scenario: a SyntaxError in user code is surfaced before any input is sent
      Given a code node whose body is "def execute(:" (invalid syntax)
      When I POST /go/studio/execute_sync
      Then the response.result.status is "error"
      And the error.type is "code_runner_error"
      And the error.message names SyntaxError and contains "invalid syntax"

  Rule: Wall-clock timeout terminates the subprocess

    # The variable reaching the executor is covered below and by
    # services/nlpgo/cmd (root_test.go). What is still unbuilt is this whole
    # path over HTTP: the kill surfacing as a `/go/studio/execute_sync` error
    # body, and the orphan-process assertion, neither of which any test makes.
    @integration @unimplemented
    Scenario: a code block exceeding NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS is killed and reports a timeout
      Given NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS is set to 2
      And a code node whose body sleeps 10 seconds
      When I POST /go/studio/execute_sync
      Then within 3 seconds the response.result.status is "error"
      And the error.message contains "timeout"
      And no orphan python3 process remains for that trace_id

    @unit
    Scenario: the operator's code-block timeout reaches the executor from the environment
      Given NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS is set to 7
      When the service loads its config and builds the code-block executor
      Then the executor's ceiling is 7 seconds

  # A per-node budget is a way to ask for LESS of the operator's ceiling,
  # never more: the ceiling bounds how long untrusted customer code may hold
  # a worker, so a workflow author cannot raise it by writing a bigger number.
  Rule: A node may ask for less time than the operator's ceiling, never more

    @unit
    Scenario: A code node's timeout_ms shortens its budget
      Given the code executor's configured ceiling is 30 seconds
      And a code node declaring parameter "timeout_ms" = 500 whose body sleeps 10 seconds
      When the engine invokes the node
      Then the node is stopped within 3 seconds
      And the node's error type is "code_block_timeout"

    @unit
    Scenario: A code node cannot raise its own timeout above the operator ceiling
      Given the code executor's configured ceiling is 500 milliseconds
      And a code node declaring parameter "timeout_ms" = 30000 whose body sleeps 10 seconds
      When the engine invokes the node
      Then the node is stopped within 3 seconds
      And the node's error type is "code_block_timeout"

    @unit
    Scenario: A missing or negative code timeout_ms falls back to the default
      Given the code executor's configured ceiling is 30 seconds
      And a code node whose "timeout_ms" parameter is missing, 0, or negative
      When the engine invokes the node
      Then the node runs to completion under the executor default
      And no timeout is reported

    @unit
    Scenario: A per-node code timeout cannot exceed the operator's ceiling
      Given the code executor's default timeout is 0.5 seconds
      And a request asking for 30 seconds whose code sleeps 10 seconds
      When the executor runs the request
      Then the run is stopped within 3 seconds
      And the result is marked timed out with error type "code_block_timeout"

    @unit
    Scenario: A negative per-node code timeout falls back to the default
      Given the code executor's default timeout is 30 seconds
      And a request asking for -1 seconds whose code returns immediately
      When the executor runs the request
      Then the result is not marked timed out
      And the declared output is returned

  Rule: Process isolation prevents cross-invocation leaks

    @integration
    Scenario: state set in one invocation does not leak to the next
      Given a code node that increments a global counter "x" and returns it
      When I invoke the workflow 5 times in succession
      Then every invocation returns x=1

  Rule: Every execution runs a freshly materialized runner

    # The runner script and its bundled `dspy` stand-in are written from the
    # engine's own embedded copy into a directory created for that one
    # execution, and the directory is removed when the execution ends. The
    # trust anchor is the embedded bytes held in the engine process, which
    # user code cannot reach, so what a later execution runs never depends on
    # what an earlier one left on disk.

    @unit
    Scenario: user code cannot change what a later execution runs
      Given one executor serving several executions
      And a first code node whose body rewrites the runner script on disk
      When the executor runs that request and then a second ordinary request
      Then the second request returns its declared output
      And the second request is unaffected by the rewrite

    @unit
    Scenario: user code cannot change the dspy stand-in a later execution imports
      Given one executor serving several executions
      And a first code node whose body rewrites the bundled dspy stand-in on disk
      When the executor runs that request and then a second request importing dspy
      Then the second request sees the shipped stand-in, not the rewritten one

    @unit
    Scenario: each execution gets its own temporary directory, removed afterwards
      Given a code node whose body writes a file next to the runner
      When the executor runs the request twice
      Then the second execution does not see the file the first one wrote
      And no execution directory is left behind once the executor is done

  Rule: A code block on the wasm runtime is contained, whatever it tries

    # The author of a code block is an untrusted tenant on a shared engine.
    # These scenarios pin what such code cannot reach or exhaust, in both
    # languages, so a regression fails here rather than in production.

    @unit
    Scenario: on the wasm runtime, a code block cannot leave its run directory
      Given a host file outside the run's directory
      And a code node that tries "..", relative traversal, a symlink, a directory symlink and a hard link to reach it
      When the executor runs the request
      Then no attempt returns the file's content

    @unit
    Scenario: on the wasm runtime, a symlink a run leaves behind cannot reach the host
      Given a code node that links a host path into its own directory and reads it
      When the executor runs the request
      Then the link is refused or resolves inside the guest, never to the host file

    @unit
    Scenario: the host bridge refuses malformed, unknown and excessive calls
      Given a code node that writes a malformed host call, an unknown operation, and more requests than a run may make
      When the executor runs the request
      Then the malformed and unknown calls get a protocol error
      And the requests past the per-run budget are refused while the earlier ones succeed

    @unit
    Scenario: the host bridge refuses an oversized call without exhausting the engine
      Given a code node that sends a request larger than the host call size limit
      When the executor runs the request
      Then the call is refused with a limit error and the run continues

    @unit
    Scenario: on the wasm runtime, a redirect cannot reach a refused address
      Given a permitted host that redirects to the cloud metadata address
      When a Python and a JavaScript code node each request it
      Then both get a "not permitted" error and the metadata address is never reached

    @unit
    Scenario: encoded, loopback, private and non-HTTP destinations are refused
      Given a code node that requests the metadata address as IPv4-mapped IPv6, decimal and octal
      And it requests the engine's own port, IPv6 loopback, a private address, a file URL and a gopher URL
      When the executor runs the request under the default egress policy
      Then every request is refused and no host file is read

    @unit
    Scenario: a JavaScript code block is held to its memory ceiling
      Given an executor with a small memory ceiling
      And a JavaScript code node that allocates without end
      When the executor runs the request
      Then the run fails on its own, not as a timeout
      And the executor runs the next request normally

    @unit
    Scenario: a JavaScript code block that recurses without end fails on its own
      Given a JavaScript code node that recurses without a base case
      When the executor runs the request
      Then the run fails with an error that is not a timeout

    @unit
    Scenario: a JavaScript code block cannot see another run's state
      Given eight JavaScript runs in parallel, each with its own secret
      And each run marks a global and a file in its directory
      When they run
      Then no run sees another run's global, file or secret

    @unit
    Scenario: an oversized result is refused instead of read into the engine
      Given a code node that returns an output larger than the result size limit
      When the executor runs the request
      Then the run fails with a runner error naming the limit and no outputs

  Rule: A wasm run's files, host calls and memory are bounded

    # /work is held in engine memory with no links, so no path a guest builds
    # resolves on the host; host calls and concurrent runs have budgets too.

    @unit
    Scenario: on the wasm runtime, a relative link cannot climb out of the run directory
      Given a code node that links "..", "../../.." and "." inside its run directory
      When the executor runs the request
      Then every link is refused

    @unit
    Scenario: on the wasm runtime, a run's files are held to a size, count and open-file budget
      Given a code node that writes 200 MiB, creates 10000 files and opens 1000 handles
      When the executor runs the request
      Then each attempt is stopped at the run's budget
      And the next run starts with an empty /work

    @unit
    Scenario: a run that keeps making failing host calls is stopped
      Given a JavaScript code node that writes unknown host calls without end
      When the executor runs the request
      Then the run is stopped well before its deadline with an error naming failing host calls

    @unit
    Scenario: a run that ignores the host's replies is stopped, not buffered
      Given a host that answers with large bodies
      And a JavaScript code node that requests it repeatedly without reading the replies
      When the executor runs the request
      Then the run is stopped with an error naming the unread replies

    @unit
    Scenario: concurrent wasm runs share a memory budget
      Given an executor whose total memory budget fits one run
      When three runs start together
      Then they run one after another
      And a run cancelled while it waits for room reports that the engine is at capacity

    @unit
    Scenario: the engine does not follow a link left in place of the result file
      Given a subprocess code node that replaces its result file with a link to an endless device
      When the executor runs the request
      Then the run fails promptly with a runner error and the device is never read

    @unit
    Scenario: code blocks reach private addresses only when the operator allows it
      Given the HTTP block is allowed to reach private addresses
      When the code-block executor is built without NLPGO_ENGINE_CODE_BLOCK_ALLOW_LOCAL_EGRESS
      Then code blocks are refused private and loopback addresses
      And the rest of the egress policy is kept
      And setting the variable allows them

    @unit
    Scenario: code blocks do not inherit the HTTP block's allow-listed hosts
      Given the HTTP block allow-lists the cloud metadata address
      When the code-block egress policy is built
      Then the allow-list is empty
      And the metadata address is still refused

    @unit
    Scenario: a run's files are charged for the memory they hold
      Given a run that writes one byte into each of many files
      When the run creates files past the byte budget's worth of storage units
      Then the next write is refused although few bytes were written
      And truncating or deleting a file returns its storage to the budget

    @unit
    Scenario: a deleted file still open keeps its storage until the last handle closes
      Given a run that opens a file, deletes it and keeps writing to the handle
      When the handle is closed
      Then the file's storage is returned to the budget only then

    @unit
    Scenario: a run's file offsets cannot overflow the engine
      Given a run that seeks, writes and truncates at offsets near the largest integer
      When the executor runs the request
      Then each call is refused with an error and the engine keeps running

    @unit
    Scenario: a run's file names are bounded
      Given a run that creates a file whose name is longer than 255 bytes
      When the executor runs the request
      Then the create is refused as a name too long

    @unit
    Scenario: oversized host calls count towards the failed-call limit
      Given a JavaScript code node that writes host calls past the frame size limit without end
      When the executor runs the request
      Then the run is stopped with an error naming failing host calls

    @unit
    Scenario: an engine whose memory budget cannot admit one run refuses to start
      Given a total wasm memory budget smaller than one run's footprint
      When the executor is built
      Then building it fails with an error naming both sizes

    @unit
    Scenario: a run's request is charged to the memory budget and capped
      Given a code node whose code and inputs exceed 16 MiB
      When the executor runs the request
      Then the run is refused before it starts with an error naming the limit

    @unit
    Scenario: a run's open files count against one budget across every mount
      Given a JavaScript code node that opens the read-only runner file 20000 times
      When the executor runs the request
      Then the opens stop at the run's handle budget
      And files open on /work and on the read-only mounts share that budget

    @unit
    Scenario: listing a large directory pages through it without holding a copy
      Given a run directory with many entries
      When the code node lists it a page at a time and deletes an entry mid-listing
      Then each remaining entry is listed once, in name order

    @unit
    Scenario: a request's DNS lookups end with the request
      Given a code block's request whose dial runs on a context detached from the request
      When the request ends
      Then the dial and its DNS lookups are cancelled

    @unit
    Scenario: a result with too many values is refused before it is decoded
      Given a JavaScript code node that returns 200000 values or 500 levels of nesting
      When the executor runs the request
      Then the run fails with a runner error naming the limit and no outputs

    @unit
    Scenario: a run that times out waiting for room is reported as a timeout
      Given an executor whose memory budget is held by another run
      When a run's deadline passes while it waits for room
      Then it is reported as timed out

    @unit
    Scenario: an engine error reaches the user without the guest's stack trace
      Given a JavaScript code node that exhausts its memory
      When the executor runs the request
      Then the error message is one line and names no wasm stack trace

  Rule: JavaScript code blocks run on QuickJS inside the engine

    # A code node whose `language` parameter is "javascript" runs on QuickJS
    # compiled to WASI, in the same wasm runtime and host bridge as Python on
    # wasm, whichever runtime Python uses (ADR-183). User code is an ES module
    # whose default export, or `execute` export, takes the inputs as one object.

    @unit
    Scenario: a JavaScript code block returns its outputs
      Given a code node in JavaScript exporting a function, an async function, an execute function or a class
      When the executor runs the request with inputs
      Then the returned object becomes the node's outputs

    @unit
    Scenario: a JavaScript code block that throws reports the error
      Given a JavaScript code node that throws a RangeError
      When the executor runs the request
      Then the error carries "RangeError" as its type, the message, and a stack naming the code block's line

    @unit
    Scenario: a JavaScript code block missing a declared output fails
      Given a JavaScript code node that does not return a declared output
      When the executor runs the request
      Then the error message names the missing output

    @unit
    Scenario: a JavaScript code block reads secrets and params
      Given a JavaScript code node that reads secrets.TOKEN, params.LIMIT and an unknown secret, and logs
      When the executor runs the request
      Then the configured values arrive, the unknown secret throws a ReferenceError
      And console.log reaches stdout and console.error reaches stderr

    @unit
    Scenario: a JavaScript code block calls fetch on a permitted host
      Given a JavaScript code node that calls fetch with headers and a body
      When the executor runs the request
      Then the requests reach the host and the response's status, headers and JSON body are readable

    @unit
    Scenario: a JavaScript code block's requests follow the deployment's egress policy
      Given a JavaScript code node that fetches metadata and loopback addresses
      When the executor runs the request under the default egress policy
      Then every request fails with a "not permitted" error and none reaches its destination

    @unit
    Scenario: a JavaScript code block has no host access
      Given a JavaScript code node that reads the environment and host files, and writes to the runner mount
      When the executor runs the request
      Then it sees only HOME and TMPDIR, reads no host file, cannot change the runner and has no os.exec

    @unit
    Scenario: a JavaScript code block is stopped at its deadline
      Given a JavaScript code node that loops forever, or waits on a long timer
      When the executor runs the request with a short timeout
      Then the run ends as a timeout close to its deadline

    @unit
    Scenario: a deployment without QuickJS refuses JavaScript code blocks
      Given an executor built without NLPGO_ENGINE_QUICKJS_WASM
      When it is asked to run a JavaScript code node
      Then it returns an error saying JavaScript is not available

  Rule: TypeScript code blocks run as JavaScript with their types erased
    # A code node whose `language` is "typescript" has its types erased by
    # esbuild in the engine, then runs on QuickJS like JavaScript. Types are
    # never checked at run time; the Studio editor checks them as you write.

    @unit
    Scenario: a TypeScript code block runs with its types erased
      Given a TypeScript code node using interfaces, type aliases, an enum and casts
      When the executor runs the request with inputs
      Then the returned object becomes the node's outputs

    @unit
    Scenario: a TypeScript code block with a type error still runs
      Given a TypeScript code node that assigns a number to a string
      When the executor runs the request
      Then it runs and returns its outputs

    @unit
    Scenario: a TypeScript code block that does not parse reports the line
      Given a TypeScript code node with a syntax error on line 2
      When the executor runs the request
      Then the error type is "SyntaxError"
      And the traceback names code-block.ts at line 2

    @unit
    Scenario: a TypeScript code block that throws points at the line it was written on
      Given a TypeScript code node whose throw is on line 7, below lines erasing drops
      When the executor runs the request
      Then the traceback names code-block.ts at line 7, not the erased JavaScript

  Rule: The wasm runtime runs each execution in its own WebAssembly instance

    # NLPGO_ENGINE_CODE_BLOCK_RUNTIME=wasm runs user code in a WASI CPython
    # inside the engine (ADR-183). Every execution is a fresh instance with
    # its own memory; the stdlib and runner are read-only mounts and /work is
    # the execution's own. The whole suite above also runs on this runtime.

    @unit
    Scenario: on the wasm runtime, a code block cannot start a process or a thread
      Given the code executor runs on the wasm runtime
      And a code node whose body tries to fork, spawn a process and start a thread
      When the executor runs the request
      Then none of the attempts starts anything

    @unit
    Scenario: on the wasm runtime, user code sees no engine environment and no process table
      Given the code executor runs on the wasm runtime
      And the engine's environment holds a credential
      When a code node reads its environment and /proc
      Then the credential is not in its environment
      And no process environment is readable through /proc

    @unit
    Scenario: on the wasm runtime, the runner and its libraries are read-only
      Given the code executor runs on the wasm runtime
      When a code node tries to rewrite the runner, the dspy stand-in or the HTTP stand-ins
      Then every write is refused

    @unit
    Scenario: on the wasm runtime, outbound requests follow the deployment's egress policy
      Given the code executor runs on the wasm runtime with the default egress policy
      When a code node requests a private address and a cloud metadata endpoint
      Then each request is refused as not permitted

    @unit
    Scenario: on the wasm runtime, requests and httpx reach a permitted host
      Given the code executor runs on the wasm runtime
      And an HTTP server the egress policy permits
      When a code node calls it through requests, a requests Session, httpx.Client and httpx.AsyncClient
      Then every call reaches the server with its method, query and headers

    @unit
    Scenario: on the wasm runtime, a run is stopped at its deadline
      Given the code executor runs on the wasm runtime
      When a code node sleeps or loops past its timeout
      Then the result is marked timed out within moments of the deadline

    @unit
    Scenario: on the wasm runtime, a run is held to its memory ceiling
      Given the code executor runs on the wasm runtime with a 128 MiB ceiling
      When a code node allocates 512 MiB
      Then the node fails with MemoryError

  Rule: Container packages a stable Python toolchain for user code

    @integration
    Scenario: the bundled Python interpreter exposes the standard library
      Given a code node whose body imports json, math, datetime, re, hashlib, base64, urllib
      When I POST /go/studio/execute_sync
      Then the node returns successfully

    @integration
    Scenario: the bundled Python interpreter does not have network access by default
      Given a code node whose body opens a TCP connection to "8.8.8.8:53"
      When I POST /go/studio/execute_sync
      Then the node's status is "success" (today's parity — no network restriction is added by the migration)
      # Note: tightening egress is tracked as a follow-up hardening item, not blocking this PR.

  Rule: Project secrets are exposed to user code as the `secrets` namespace

    # Parity with the Python executor's build_secrets_preamble
    # (langwatch_nlp/studio/utils.py): decrypted project secrets ride on
    # the workflow DSL (`workflow.secrets`, populated by
    # WorkflowService.prepareStudioEvent) and
    # are surfaced to user code as attribute access on a `secrets` object,
    # matching the Studio code-editor hint ("Use secrets.NAME syntax").

    @unit
    Scenario: a configured project secret is readable as secrets.NAME
      Given the workflow carries secret "CLOUDFLARE_ACCESS_CLIENT_ID" = "id-123"
      And a code node whose body returns {"token": secrets.CLOUDFLARE_ACCESS_CLIENT_ID}
      When the engine invokes the node
      Then the node's output equals {"token": "id-123"}
      And the node's status is "success"

    @unit
    Scenario: referencing an undefined secret raises AttributeError, not NameError
      Given the workflow carries secret "PRESENT" = "yes"
      And a code node whose body returns {"x": secrets.ABSENT}
      When the engine invokes the node
      Then the node's status is "error"
      And the error message contains "ABSENT"

    @unit
    Scenario: with no project secrets the `secrets` name is left undefined (Python parity)
      Given the workflow carries no secrets
      And a code node whose body returns {"x": secrets.ANYTHING}
      When the engine invokes the node
      Then the node's status is "error"
      And the error message contains "secrets"

    # Stored stdout and stderr ride along on execution events, traces and
    # logs exactly as node errors do, so a printed credential is exposed as
    # widely as one echoed in an error message.
    @unit
    Scenario: Secret values are scrubbed from stored code node stdout and stderr
      Given the workflow carries secret "API_TOKEN" = "sk-live-abc123"
      And the run carries parameter "REGION" = "eu-central"
      And a code node whose body prints both to stdout, and the secret to stderr
      When the engine invokes the node
      Then the stored stdout shows the secret value as "[redacted]"
      And the stored stderr shows the secret value as "[redacted]"
      And the stored stdout still contains "eu-central", because a run parameter is not a credential

  Rule: A run's own LangWatch credential reaches user code through the environment

    # Project secrets never travel in the environment. The one exception is
    # the credential the run itself mints for the sandbox: it belongs to one
    # run, reaches the project's agent cache and nothing else, and expires by
    # itself. It travels in the environment because that is where the
    # LangWatch SDK reads LANGWATCH_API_KEY and LANGWATCH_ENDPOINT, so any
    # other place would mean every agent wiring it up by hand.

    @unit
    Scenario: the run's credential and endpoint reach user code
      Given the run carries a sandbox key
      And the engine knows the LangWatch endpoint
      When the engine invokes a code node
      Then user code reads the sandbox key as LANGWATCH_API_KEY
      And user code reads the endpoint as LANGWATCH_ENDPOINT
      And user code reads LANGWATCH_SKIP_OTEL_SETUP as "true", because the run already reports the row

    @unit
    Scenario: a run with no sandbox key gets no LangWatch environment at all
      Given the run carries no sandbox key
      And the engine knows the LangWatch endpoint
      When the engine invokes a code node
      Then user code reads none of the three variables
      # An endpoint with no key gives agent code half a credential and one
      # failure it cannot act on.

    @unit
    Scenario: a sandbox key with no endpoint is not injected either
      Given the run carries a sandbox key
      And the engine does not know the LangWatch endpoint
      When the engine invokes a code node
      Then user code reads none of the three variables

    @unit
    Scenario: the engine's own LangWatch key never reaches user code
      Given the engine's environment carries its own LANGWATCH_API_KEY
      And the run carries no sandbox key
      When the engine invokes a code node
      Then user code reads no LANGWATCH_API_KEY

    @unit
    Scenario: The sandbox key is scrubbed from stored code node stdout and stderr
      Given the run carries a sandbox key
      And a code node whose body prints the whole environment
      When the engine invokes the node
      Then the stored stdout shows the sandbox key as "[redacted]"
      And the stored stderr shows the sandbox key as "[redacted]"

    # A node error carries the exception text and the traceback the runner
    # captured, and it travels the same execution events, traces and logs the
    # stored output travels. An exception raised inside a call that carries the
    # credential quotes it, so the error is scrubbed the same way.
    @unit
    Scenario: The sandbox key is scrubbed from a code node error
      Given the run carries a sandbox key
      And a code node whose body raises an exception that quotes the sandbox key
      When the engine invokes the node
      Then the node error message shows the sandbox key as "[redacted]"
      And the node error traceback shows the sandbox key as "[redacted]"

  # The former "identical outputs on Go and Python" parity scenario was removed:
  # the Python langwatch_nlp engine has been removed (see _shared/contract.md —
  # nlpgo is the sole NLP engine), so /studio/execute_sync no longer exists and
  # there is no second engine to compare against.

  Rule: The failure shape the TypeScript scenario adapter classifies on stays stable

    # langwatch#3439. The TS SerializedCodeAgentAdapter decides "user code
    # failed" vs "our infra failed" from this endpoint's response. It once
    # classified against a FastAPI envelope this engine has never served, and
    # nothing caught it because the TS side mocked the response by hand. These
    # scenarios pin the shape the adapter depends on, from the engine side.

    @integration
    Scenario: a failing code block is reported as a 200 the TS adapter can classify
      Given a code node whose body raises a Python exception
      When the engine invokes the node
      Then the HTTP response status is 200, not an error status
      And the response status field is "error"
      And the error carries the raised exception class as its type
      And the error carries a message, a traceback, and the failing node id
      And the error type is not one the TS adapter treats as an infra failure

    @integration
    Scenario: an unparseable workflow is reported with a type the TS adapter treats as infra
      Given a workflow whose nodes cannot be parsed
      When the engine is asked to execute it
      Then the response status field is "error"
      And the error type is "invalid_workflow"

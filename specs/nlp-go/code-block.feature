Feature: Code block — execute user Python with isolated subprocess and structured I/O
  The code block runs arbitrary Python written by the workflow author. nlpgo
  spawns a Python subprocess for each invocation — the runner it carries in its
  own binary, passed to the interpreter as source — hands the interpreter the
  declared inputs as JSON when it asks for them, and reads declared outputs
  from a result file. Sandboxing is process isolation with no syscall
  restrictions, so existing customer code keeps working byte-for-byte; what the
  four isolation rules below add is that one execution cannot reach another's
  code, directory, processes or payload.

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
    # services/nlpgo/cmd (root_test.go), and the orphan-process assertion by
    # the teardown scenario further down. What is still unbuilt is this path
    # over HTTP: the kill surfacing as a `/go/studio/execute_sync` error body.
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

  Rule: No code the interpreter loads comes from a writable location

    # On the multi-tenant cloud many customers' code blocks run in one nlpgo
    # container, so an execution is isolated from the other executions and not
    # only from the engine. The runner script and its bundled `dspy` stand-in
    # are never written to the filesystem: they travel from the engine's own
    # embedded copy to the interpreter over argv and stdin, and the runner
    # drops the working directory from sys.path before any user code runs.
    # Everything the interpreter loads therefore comes either from the engine's
    # memory or from the image's read-only library path.

    @unit
    Scenario: the runner and the dspy stand-in are never written to disk
      Given a code node whose body reports what it can see of the runner
      When the engine invokes the node
      Then the dspy stand-in carries no file path
      And the execution's working directory holds no Python source
      And the working directory is not on sys.path

    @unit
    Scenario: an import is never answered by the execution's working directory
      Given a code node whose body writes a module into its working directory
      When the code imports that module
      Then the import fails
      And an import of the dspy stand-in still resolves to the shipped one

    @unit
    Scenario: user code cannot change what a later execution runs
      Given one executor serving several executions
      And a first code node whose body writes a runner script of its own
      When the executor runs that request and then a second ordinary request
      Then the second request returns its declared output
      And the second request is unaffected by what the first one wrote

    @unit
    Scenario: user code cannot change the dspy stand-in a later execution imports
      Given one executor serving several executions
      And a first code node whose body writes a dspy stand-in of its own
      When the executor runs that request and then a second request importing dspy
      Then the second request sees the shipped stand-in, not the written one

  Rule: An execution's working directory is reachable only from that execution

    # Each execution gets a directory with a random name, inside a per-process
    # root with no read permission: the root cannot be listed, so a directory
    # cannot be found by walking to it, and it is removed when the execution
    # ends. Everything in the container runs as one user, so this is a barrier
    # against discovery rather than one the kernel enforces — the only thing
    # that would enforce it is a UID per execution, which the container cannot
    # have (non-root, every capability dropped, no_new_privs).

    @unit
    Scenario: each execution gets its own working directory, removed afterwards
      Given a code node whose body writes a file in its working directory
      When the executor runs the request twice
      Then the second execution does not see the file the first one wrote
      And no execution directory is left behind once the executor is done

    @unit
    Scenario: an execution cannot reach another execution's working directory
      Given a code node whose body goes looking for other executions
      When the executor runs it beside another execution
      Then listing the root that holds the execution directories is refused
      And a directory belonging to a finished execution cannot be read or written

  Rule: One execution cannot read another execution's process

    # Everything in the container runs as one user, and /proc hands a process
    # running as that user another's open descriptors, initial variables and
    # working directory. A descriptor exec hands the interpreter can be cloned
    # in the moment before the runner hides itself, so the interpreter is
    # handed nothing of the run: no payload, no credential, no directory and
    # no path on its command line. Once non-dumpable it asks nlpgo for its
    # payload over a socket nlpgo answers by the pid the kernel reports for
    # the process connecting, and moves into its working directory from it.
    # The pid is the whole check, so the payload is handed over once and an
    # ask from anything else is answered with nothing. Where that socket
    # exists and cannot be bound, the engine refuses to run code blocks at
    # all rather than put a payload back on a descriptor.
    #
    # The limit: a process USER CODE starts is a fresh exec, which the kernel
    # makes dumpable again, and it inherits the run's credential and directory
    # from the runner's environment. A concurrent execution can read those out
    # of such a child for as long as it runs. Closing that needs a uid per
    # execution, which the container cannot have.

    @unit
    Scenario: one execution cannot read another's payload, variables or directory through /proc
      Given a code node whose body reads the /proc entries of another running execution
      When the executor runs it beside that execution
      Then reading the other execution's open descriptors is refused
      And reading its initial variables is refused
      And reading its working directory is refused
      And reading its process state still works, because teardown reads it

    @unit
    Scenario: the interpreter is handed nothing belonging to the run
      Given a code node whose body reports the descriptors it was started with
      When the engine invokes the node
      Then its standard input is empty, because the payload did not arrive on one
      And the file its errors go to has no name another execution could open
      And that file is not inside the run's working directory

    @unit
    Scenario: the payload channel answers only the interpreter it started, once
      Given a code node whose body asks nlpgo for a payload, from the interpreter and from a process it starts
      When the engine invokes the node
      Then the interpreter asking again is told nothing, because its payload was handed over once
      And the process the code started is told nothing, because it is not an execution the engine started

    @unit
    Scenario: the run's credential is never in the interpreter's initial variables
      Given the run carries a sandbox key
      When the engine invokes a code node
      Then user code still reads the key as LANGWATCH_API_KEY
      And the key is not among the variables the interpreter was started with
      And the command line names no directory belonging to the run

    @unit
    Scenario: a result file this execution did not write is not read as its output
      Given a code node whose body writes a result file of its own and exits
      When the executor runs the request
      Then the execution reports a runner error
      And the values in that file are not returned as the node's outputs

  Rule: No process an execution started outlives it

    # The interpreter leads a process group of its own and every exit path
    # kills the group — success, user-code error and timeout alike. A process
    # that detached from the group by calling setsid cannot also stop being a
    # descendant: orphans reparent to the nearest ancestor marked
    # PR_SET_CHILD_SUBREAPER, which the engine marks itself, so teardown finds
    # them as its own children, kills them and collects their exit status.
    # This needs no capability, no cgroup write, no PID namespace and no second
    # UID, which is what makes it deployable in the shipped container.
    #
    # Adoption says an execution started a process, not which one. A process
    # that also erased the run's marks from its environment and working
    # directory is swept by the first teardown that can tell it apart from
    # every execution still running, which is the moment it is older than all
    # of them: killing a live tenant's helper would be worse than sweeping one
    # process late.

    @unit
    Scenario: no process an execution started is left running
      Given a code node whose body starts a process in a session of its own
      When the execution returns an output, raises, or runs out of time
      Then the process it started is gone once the executor returns
      And a process that detached with a scrubbed environment is gone too
      And an execution running beside it is left alone

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

Feature: Code block — execute user Python with isolated subprocess and structured I/O
  The code block runs arbitrary Python written by the workflow author. nlpgo
  spawns a Python subprocess (helper script bundled in the container) for each
  invocation, marshals declared inputs as JSON over stdin, and reads declared
  outputs as JSON over stdout. Sandboxing matches today's Python NLP behavior
  (process isolation; no syscall restrictions) so existing customer code keeps
  working byte-for-byte.

  See _shared/contract.md §7.

  Background:
    Given nlpgo is listening on :5562
    And a Python 3.12+ interpreter is available on PATH inside the container

  Rule: Inputs are passed by name and outputs are read by name

    @unit @unimplemented
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

    @unit @unimplemented
    Scenario: a missing declared output is reported as an error
      Given a code node declaring outputs ["sum", "diff"]
      And the code body returns only {"sum": 5}
      When the engine invokes the node
      Then the node's status is "error"
      And the error message contains "missing_output: diff"

    @unit @unimplemented
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

  Rule: Exceptions are surfaced as structured errors with the traceback

    @integration @unimplemented
    Scenario: ZeroDivisionError aborts the node and the workflow with the traceback intact
      Given a code node whose body computes 1/0
      When I POST /go/studio/execute_sync
      Then the response.result.status is "error"
      And the error.node_id matches the code node id
      And the error.message contains "ZeroDivisionError: division by zero"
      And the error.traceback contains the user code line that triggered the error

    @integration @unimplemented
    Scenario: a SyntaxError in user code is surfaced before any input is sent
      Given a code node whose body is "def execute(:" (invalid syntax)
      When I POST /go/studio/execute_sync
      Then the response.result.status is "error"
      And the error.message contains "SyntaxError"

  Rule: Wall-clock timeout terminates the subprocess

    @integration @unimplemented
    Scenario: a code block exceeding NLP_CODE_BLOCK_TIMEOUT_SECONDS is killed and reports a timeout
      Given NLP_CODE_BLOCK_TIMEOUT_SECONDS is set to 2
      And a code node whose body sleeps 10 seconds
      When I POST /go/studio/execute_sync
      Then within 3 seconds the response.result.status is "error"
      And the error.message contains "timeout"
      And no orphan python3 process remains for that trace_id

  Rule: Process isolation prevents cross-invocation leaks

    @integration @unimplemented
    Scenario: state set in one invocation does not leak to the next
      Given a code node that increments a global counter "x" and returns it
      When I invoke the workflow 5 times in succession
      Then every invocation returns x=1

  Rule: Container packages a stable Python toolchain for user code

    @integration @unimplemented
    Scenario: the bundled Python interpreter exposes the standard library
      Given a code node whose body imports json, math, datetime, re, hashlib, base64, urllib
      When I POST /go/studio/execute_sync
      Then the node returns successfully

    @integration @unimplemented
    Scenario: the bundled Python interpreter does not have network access by default
      Given a code node whose body opens a TCP connection to "8.8.8.8:53"
      When I POST /go/studio/execute_sync
      Then the node's status is "success" (today's parity — no network restriction is added by the migration)
      # Note: tightening egress is tracked as a follow-up hardening item, not blocking this PR.

  Rule: Parity with Python code-node executor

    @integration @parity @unimplemented
    Scenario: identical user code + inputs produce identical outputs on Go and Python
      Given a fixture code workflow at tests/fixtures/workflows/code_only.json
      And the same input
      When I POST the input to /go/studio/execute_sync (Go) and /studio/execute_sync (Python)
      Then both responses' result.outputs are byte-equivalent
      And both responses' stdout captures are byte-equivalent

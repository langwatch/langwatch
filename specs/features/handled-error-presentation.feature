Feature: Handled errors — what the customer actually reads

  ADR-045 settled what crosses the boundary; #5984 settled that a handled
  error's free-text message is NOT part of it. A HandledError's message is
  server copy — it names env vars, hostnames and internal services — so the
  wire message is the stable `code` on every transport, and the structured
  payload (`code`, `meta`, `tips`, `docsUrl`, `fault`, `traceId`) is the whole
  client contract.

  That left the client half undone: ~105 call sites rendered `error.message`
  straight into a toast, which after #5984 shows the customer a code slug —
  "validation_error", "project_slug_taken". These scenarios pin the other half
  of the contract: where the words come from, who may see what, and what stops
  the raw-message habit growing back.

  The rule in one line: the server emits the typed fact, and a single
  code-keyed registry on the client turns it into English.

  Background:
    Given the boundary attaches the handled payload to `data.error`
    And the boundary attaches a trace id to `data.traceId` for every failure
    And the client presentation registry is keyed by error code

  # ==========================================================================
  # Where the words come from
  # ==========================================================================

  @bdd @handled-errors @presentation
  Scenario: A recognised code is described by the registry, never by the wire
    Given a procedure fails with the handled code "query_timeout"
    When the client surfaces that failure
    Then the title and description come from the registry entry for that code
    And the customer never reads the code slug itself
    And the customer never reads the server's free-text message

  @bdd @handled-errors @presentation
  Scenario: A caller's generic headline loses to specific copy
    Given a call site surfaces an error with the fallback title "Couldn't create project"
    When the failure is a recognised code with its own title
    Then the registry's title is shown, because it describes the actual failure
    But when the failure is unrecognised or unhandled
    Then the call site's fallback title is shown, so the customer still knows
      which action failed

  @bdd @handled-errors @presentation
  Scenario: An unrecognised code degrades on fault, not on the code
    Given the client receives a handled code it has no entry for
      # a Go service or a rolling deploy running ahead of this client
    When the client surfaces it
    Then a "customer" fault reads as a problem with the input
    And a "platform" or "provider" fault reads as a problem on our end
    And the code slug is never shown

  @bdd @handled-errors @presentation
  Scenario: Server-authored prose travels only in the explicit channel
    Given a handled error carries prose in `meta.message`
      # the deliberate opt-in, mirroring Go's Meta["message"]
    When the client has no registry entry for its code
    Then that prose is shown as the description
    And no other field is treated as prose

  # ==========================================================================
  # What a customer may see
  # ==========================================================================

  @bdd @handled-errors @presentation
  Scenario: Remediation reaches the customer
    Given a handled error carries tips and a docs URL
    When it is surfaced inline
    Then every tip is listed and the docs link is offered
    And when it is surfaced as a toast
    Then the most actionable tip is folded into the description
      # a toast has room for a sentence, not a bulleted list

  @bdd @handled-errors @presentation
  Scenario: Technical detail stops at the trace id
    Given a handled error carries meta and a chain of reasons
    When it is surfaced to a customer
    Then the trace id is offered as a copyable error id
    But the raw meta is not rendered
    And the reason chain is not rendered
      # both are for agents and logs; a person gets an id to quote at support

  @bdd @handled-errors @presentation
  Scenario: meta is read only where the client knows its shape
    Given the registry entry for a code declares how to read its meta
    When that meta is present and of the expected type
    Then it is woven into the description
    But when it is absent, or of an unexpected type
    Then the description falls back rather than rendering the raw value

  @bdd @handled-errors @presentation
  Scenario: An unhandled failure says nothing, but stays traceable
    Given a procedure fails with an unhandled error
    When the client surfaces it
    Then the customer reads one calm generic message
    And no detail of the failure is shown
    And a copyable error id is still offered, so support can correlate it
      # the one thing an unhandled error is allowed to tell the client

  # ==========================================================================
  # Workflow node failures cross the language boundary as codes
  # ==========================================================================

  @bdd @handled-errors @presentation
  Scenario: A workflow node failure reaches the customer as a code, not a Go string
    Given an experiment target calls an HTTP agent whose host does not resolve
    When the nlpgo engine returns its NodeError for the failed node
    Then the streamed execution state carries the stable code, not only the
      raw message
      # the message ("httpblock: … lookup …: no such host") is engineer-facing
    And the target_result carries a handled payload built from that code
    And the customer reads the registry copy for the code ("Couldn't reach the
      agent"), never the Go net error

  @bdd @handled-errors @presentation
  Scenario: A node error code with no customer copy fails the build
    Given the presentation registry is exhaustive over the generated node codes
    When the nlpgo engine gains a new `NodeError.Type`
    And `herrgen` regenerates the node code list
    Then the project fails to type-check until that code's copy is written
      # the same enforcement the herr codes get, extended to node errors

  # ==========================================================================
  # Validation belongs on the form
  # ==========================================================================

  @bdd @handled-errors @presentation
  Scenario: A rejected submission lands on the fields that caused it
    Given a form submit fails with a validation error naming its fields
    When the form is bound to the handled-error bridge
    Then each named field the form owns is marked with its message
    And the first of them takes focus, so a rejection below the fold is seen
    And no toast is shown, because the rejection is already visible

  @bdd @handled-errors @presentation
  Scenario: A validation error the form does not own is not swallowed
    Given a form submit fails with a validation error naming fields the form
      does not have
    When the bridge is offered that error
    Then it declines it
    And the failure falls through to a toast rather than disappearing

  # ==========================================================================
  # Keeping it that way
  # ==========================================================================

  @bdd @handled-errors @presentation
  Scenario: An error code without customer copy fails the build
    Given the presentation registry is exhaustive over every known error code
    When a new code is added to the TypeScript app
    Or a new code is added to a Go service and regenerated
    Then the project fails to type-check until its copy is written

  @bdd @handled-errors @presentation
  Scenario: The list of app codes cannot drift from the code that raises them
    Given the app error codes are enumerated for the registry to be keyed on
    When a HandledError subclass raises a code that is not enumerated
    Then the suite fails, because that error would reach a customer with no copy
    And when a code is enumerated that nothing raises
    Then the suite fails too, because its copy is dead

  @bdd @handled-errors @presentation
  Scenario: The raw-message habit cannot grow back
    Given error toasts must be raised through the shared helper
    When a call site renders an error's raw message into a toast instead
    Then the suite fails and names the file and line
      # a type cannot catch this: `error.message` is a perfectly good string

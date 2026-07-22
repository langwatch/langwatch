Feature: Handled errors — what the customer actually reads

  ADR-045 settled what crosses the boundary; #5984 settled that a handled
  error's free-text message is not what the app renders. Over tRPC the wire
  message is the stable `code`, and the structured payload (`code`, `meta`,
  `tips`, `docsUrl`, `fault`, `traceId`) is the whole client contract. The
  message itself is written customer-safe — nothing on a handled error is
  sensitive, which is what "handled" means — but it is copy for a consumer with
  no registry to read, not the words this app puts on screen.

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
    And a "platform" fault reads as a problem on our end
    And a "provider" fault reads as a connected service that didn't answer
      # deliberately a third party — telling the customer it was us is both
      # wrong and less actionable
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
  Scenario: Remediation reaches the customer when we have nothing better
    Given a handled error carries tips and a docs URL
    And the client has no copy of its own for that code
    When it is surfaced inline
    Then every tip is listed and the docs link is offered
    And when it is surfaced as a toast
    Then the most actionable tip is folded into the description
      # a toast has room for a sentence, not a bulleted list

  @bdd @handled-errors @presentation
  Scenario: Our own copy replaces the tips rather than joining them
    Given a handled error carries tips and a docs URL
    And the client has copy of its own for that code
    When it is surfaced, inline or as a toast
    Then the customer reads that copy and no tips at all
      # the two are competing authorings of the same remediation — the
      # description and the first tip both say "narrow the time range" — so
      # showing both makes the surface repeat itself
    And the docs link is still offered
      # docs are an extra destination, not a second phrasing, so they never
      # compete with the description

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

  @bdd @handled-errors @presentation
  Scenario: An error id stays readable where it cannot be copied
    Given a failure carrying an error id
    And the browser offers no clipboard, as on an insecure origin
    When the client surfaces it
    Then the error id is shown as selectable text instead
      # withholding the copy button must not withhold the id itself —
      # otherwise the customer has nothing to quote to support

  # ==========================================================================
  # Prose a procedure wrote for a person survives the migration
  # ==========================================================================

  @bdd @handled-errors @presentation
  Scenario: A plain 4xx keeps the sentence its procedure authored
    Given a procedure fails with a plain client error carrying authored copy
      # e.g. "You've already used this invite" — several hundred such
      # throw sites predate handled errors, and #5984 left them alone
    When the client surfaces it
    Then the customer reads that sentence
    And the caller's own headline names the action that failed

  @bdd @handled-errors @presentation
  Scenario Outline: Only the boundary decides what counts as authored copy
    Given a procedure fails with <shape>
      # the test needs the error's cause, which never crosses the wire, so the
      # client cannot make this call for itself
    When the client surfaces it
    Then the customer reads the calm generic message instead

    Examples:
      | shape                                                           |
      | a client error carrying no message of its own                   |
      | a client error whose message was inherited from what it wrapped |
      # wrapping a caught failure is fine on its own — what disqualifies the
      # message is being the same sentence as something in the cause chain,
      # which is the tell that nobody wrote it for a person

  @bdd @handled-errors @presentation
  Scenario Outline: A machine's diagnostic is not mistaken for authored copy
    Given a procedure fails with a plain client error whose message is <shape>
      # routers that wrap a caught failure in a 4xx would otherwise reopen at
      # 4xx the leak that #5984 closed at 5xx
    When the client surfaces it
    Then the customer reads the calm generic message instead

    Examples:
      | shape                           |
      | a database driver's diagnostic  |
      | a socket error code             |
      | a stack frame                   |
      | a socket address with a port    |
      | longer than a sentence or two   |
      # deliberately narrow: a bare address a person typed ("The IP 10.0.0.1 is
      # not allowed as a webhook destination") is real copy and must survive

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

  @bdd @handled-errors @presentation
  Scenario: A form-level complaint is only claimed by a form that can show it
    Given a form submit fails with a validation error about the submission as
      a whole, rather than about any one field
    And the form renders the form-level error slot
    When the bridge is offered that error
    Then the complaint is shown at the top of the form
    And no toast is shown, because the rejection is already visible

  @bdd @handled-errors @presentation
  Scenario: A form with no error slot never swallows the rejection
    Given a form submit fails with a validation error about the submission as
      a whole
    And the form does not render the form-level error slot
    When the bridge is offered that error
    Then it declines it
    And the failure falls through to a toast
      # silence is the worst outcome available here: claiming the error would
      # suppress the toast and display nothing, so pressing Save would appear
      # to do nothing at all

  # ==========================================================================
  # Keeping it that way
  # ==========================================================================

  @bdd @handled-errors @presentation
  Scenario: A Go service's new code fails the build until its copy is written
    Given the presentation registry is exhaustive over every enumerated code
    When a new code is added to a Go service and the code list is regenerated
    Then the project fails to type-check until its copy is written

  @bdd @handled-errors @presentation
  Scenario: A new app code is caught by the suite first, then by the compiler
    Given the presentation registry is exhaustive over every enumerated code
    When a new code is added to the TypeScript app
    Then the suite fails first, because the code is raised but not enumerated
      # the compiler cannot see a code that is nowhere in the list — nothing
      # in the type system reflects over "every HandledError subclass"
    And once it is enumerated, the project fails to type-check until its copy
      is written

  @bdd @handled-errors @presentation
  Scenario: The list of app codes cannot drift from the code that raises them
    Given the app error codes are enumerated for the registry to be keyed on
    And every tree that can raise one is searched — the app, the enterprise
      tree, and the workspace packages
      # a guard that only looks where the codes already are is a guard that
      # passes forever: the enterprise impersonation errors sat outside it,
      # so none of them was ever required to have copy
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

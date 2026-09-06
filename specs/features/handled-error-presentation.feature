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

  @unit @integration @bdd @handled-errors @presentation
  Scenario: A recognised code is described by the registry, never by the wire
    Given a procedure fails with the handled code "query_timeout"
    When the client surfaces that failure
    Then the title and description come from the registry entry for that code
    And the customer never reads the code slug itself
    And the customer never reads the server's free-text message

  @unit @integration @bdd @handled-errors @presentation
  Scenario: A caller's generic headline loses to specific copy
    Given a call site surfaces an error with the fallback title "Couldn't create project"
    When the failure is a recognised code with its own title
    Then the registry's title is shown, because it describes the actual failure
    But when the failure is unrecognised or unhandled
    Then the call site's fallback title is shown, so the customer still knows
      which action failed

  # This used to say the copy degrades on FAULT, and that was a guess dressed
  # as a fact: `fault` defaults to `customer` server-side, so a platform
  # failure on a payload predating the field told the customer to check their
  # input, and a `provider` fault told them a connected service didn't answer
  # about their own Python error. The code is the one thing actually known,
  # and a customer can quote it to support. Fault is the fallback only when
  # there is no code at all — which is when it genuinely is all we have.
  @unit @bdd @handled-errors @presentation
  Scenario: An unrecognised code degrades to the code itself, not to a guess at the fault
    Given the client receives a handled code it has no entry for
      # a Go service or a rolling deploy running ahead of this client
    When the client surfaces it
    Then the code is read back as a sentence — "Dataset import stalled"
    And it says the same thing whatever the payload's fault claims
    And a caller that named the action keeps its own headline instead
    But when the failure carries no code at all
    Then fault is the only thing known about it, and the copy degrades to that

  @unit @bdd @handled-errors @presentation
  Scenario: An unrecognised code renders no prose at all
    Given a handled error carries prose in `meta.message`
    When the client has no registry entry for its code
    Then no description is shown
      # the client cannot say who wrote that sentence, whether it was meant
      # for a customer, or whether it is an upstream body relayed through a
      # hop it cannot see — and a provider writes the key it rejected into
      # exactly this field
    And the customer reads the server's remediation tip, or the generic
      line and a trace id
    And no other field is treated as prose

  # ==========================================================================
  # What a customer may see
  # ==========================================================================

  @unit @bdd @handled-errors @presentation
  Scenario: A missing-model rejection is explained per the surface that raised it
    Given a handled error carries the code "missing_model"
    And its meta names the request surface (chat, messages, responses,
      embeddings, speech, transcription, or the Gemini passthrough)
    When the client surfaces it
    Then the description says where THAT surface expects its model
      # each surface disagrees about where a model comes from — a JSON field,
      # a form part, or the request URL — so one generic sentence would send
      # some callers looking for something that does not exist on their surface
    But when the surface named in meta is not one the client recognises
    Then the description falls back to a surface-neutral sentence

  # The relay reduces a provider failure to a bounded reason code under
  # "llm_upstream_error". The copy for each reason class is ours to write —
  # and the classes genuinely disagree about what the customer should do next.
  @unit @bdd @handled-errors @presentation
  Scenario: A provider-refused credential gets its own remediation copy
    Given a handled error carries the code "llm_upstream_error"
    And its reason says the provider refused the credential or its permissions
    When the client surfaces it
    Then the description points at the key and its permissions
    And it does not suggest retrying, because a retry cannot succeed

  @unit @bdd @handled-errors @presentation
  Scenario: A provider rate limit gets its own remediation copy
    Given a handled error carries the code "llm_upstream_error"
    And its reason says the provider rate-limited the call
    When the client surfaces it
    Then the description says to wait before retrying

  @unit @bdd @handled-errors @presentation
  Scenario: A provider outage gets its own remediation copy
    Given a handled error carries the code "llm_upstream_error"
    And its reason says the provider timed out or was unavailable
    When the client surfaces it
    Then the description names a temporary provider problem, not a caller mistake

  @unit @bdd @handled-errors @presentation
  Scenario: An unrecognised upstream reason falls back to the generic retry line
    Given a handled error carries the code "llm_upstream_error"
    And its reason is one the client does not classify
    When the client surfaces it
    Then the description falls back to the generic retry-or-switch-model line

  @unit @integration @bdd @handled-errors @presentation
  Scenario: Remediation reaches the customer when we have nothing better
    Given a handled error carries tips and a docs URL
    And the client has no copy of its own for that code
    When it is surfaced inline
    Then every tip is listed and the docs link is offered
    And when it is surfaced as a toast
    Then the most actionable tip is folded into the description
      # a toast has room for a sentence, not a bulleted list

  # This used to say our copy replaces the tips wholesale. It doesn't, and it
  # shouldn't: suppressing every tip whenever the registry had ANY description
  # threw away the escalation path on nearly every error —
  # `clickhouse_unavailable`'s "check the status page or contact support"
  # never once reached a customer. Only the tip that REPEATS the description
  # is the duplicate.
  @unit @integration @bdd @handled-errors @presentation
  Scenario: A tip that repeats our copy is dropped, one that adds to it is kept
    Given a handled error carries tips and a docs URL
    And the client has copy of its own for that code
    When it is surfaced, inline or as a toast
    Then a tip saying what the description already said is not shown
      # the two are competing authorings of the same remediation — the
      # description and the first tip both say "narrow the time range" — so
      # showing both makes the surface repeat itself
    And a tip that adds something the description did not say is still shown
    And the docs link is still offered
      # docs are an extra destination, not a second phrasing, so they never
      # compete with the description

  @unit @integration @bdd @handled-errors @presentation
  Scenario: Technical detail stops at the trace id
    Given a handled error carries meta and a chain of reasons
    When it is surfaced to a customer
    Then the trace id is offered as a copyable error id
    But the raw meta is not rendered
    And the reason chain is not rendered
      # both are for agents and logs; a person gets an id to quote at support

  @unit @bdd @handled-errors @presentation
  Scenario: meta is read only where the client knows its shape
    Given the registry entry for a code declares how to read its meta
    When that meta is present and of the expected type
    Then it is woven into the description
    But when it is absent, or of an unexpected type
    Then the description falls back rather than rendering the raw value

  @unit @integration @bdd @handled-errors @presentation
  Scenario: An unhandled failure says nothing, but stays traceable
    Given a procedure fails with an unhandled error
    When the client surfaces it
    Then the customer reads one calm generic message
    And no detail of the failure is shown
    And a copyable error id is still offered, so support can correlate it
      # the one thing an unhandled error is allowed to tell the client

  @integration @bdd @handled-errors @presentation
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

  @unit @bdd @handled-errors @presentation
  Scenario: A plain 4xx keeps the sentence its procedure authored
    Given a procedure fails with a plain client error carrying authored copy
      # e.g. "You've already used this invite" — several hundred such
      # throw sites predate handled errors, and #5984 left them alone
    When the client surfaces it
    Then the customer reads that sentence
    And the caller's own headline names the action that failed

  @unit @bdd @handled-errors @presentation
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

  @unit @bdd @handled-errors @presentation
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

  @unit @bdd @handled-errors @presentation
  Scenario: A workflow node failure reaches the customer as a code, not a Go string
    Given an experiment target calls an HTTP agent whose host does not resolve
    When the nlpgo engine returns its NodeError for the failed node
    Then the streamed execution state carries the stable code, not only the
      raw message
      # the message ("httpblock: … lookup …: no such host") is engineer-facing
    And the target_result carries a handled payload built from that code
    And the customer reads the registry copy for the code ("Couldn't reach the
      agent"), never the Go net error

  # @unimplemented: the enforcement is the exhaustive `satisfies` in
  # `presentation.ts`, so the failure is a type error and no runtime test can
  # observe it. What IS pinned is that the check cannot go vacuous —
  # `presentation.unit.test.ts` fails if the generated code sets come back
  # empty, which is the one way a `Record` over `never` starts accepting
  # anything.
  @unit @unimplemented @bdd @handled-errors @presentation
  Scenario: A node error code with no customer copy fails the build
    Given the presentation registry is exhaustive over the generated node codes
    When the nlpgo engine gains a new `NodeError.Type`
    And `herrgen` regenerates the node code list
    Then the project fails to type-check until that code's copy is written
      # the same enforcement the herr codes get, extended to node errors

  # ==========================================================================
  # Validation belongs on the form
  # ==========================================================================

  @unit @bdd @handled-errors @presentation
  Scenario: A rejected submission lands on the fields that caused it
    Given a form submit fails with a validation error naming its fields
    When the form is bound to the handled-error bridge
    Then each named field the form owns is marked with its message
    And the first of them takes focus, so a rejection below the fold is seen
    And no toast is shown, because the rejection is already visible

  @unit @bdd @handled-errors @presentation
  Scenario: A validation error the form does not own is not swallowed
    Given a form submit fails with a validation error naming fields the form
      does not have
    When the bridge is offered that error
    Then it declines it
    And the failure falls through to a toast rather than disappearing

  @unit @bdd @handled-errors @presentation
  Scenario: A form-level complaint is only claimed by a form that can show it
    Given a form submit fails with a validation error about the submission as
      a whole, rather than about any one field
    And the form renders the form-level error slot
    When the bridge is offered that error
    Then the complaint is shown at the top of the form
    And no toast is shown, because the rejection is already visible

  @unit @bdd @handled-errors @presentation
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

  # @unimplemented: same reason as the node-code scenario above — the guard is
  # a compile-time `satisfies`, not something a suite can execute. The
  # scenario below it covers the half that IS executable.
  @unit @unimplemented @bdd @handled-errors @presentation
  Scenario: A Go service's new code fails the build until its copy is written
    Given the presentation registry is exhaustive over every enumerated code
    When a new code is added to a Go service and the code list is regenerated
    Then the project fails to type-check until its copy is written

  @unit @bdd @handled-errors @presentation
  Scenario: A new app code is caught by the suite first, then by the compiler
    Given the presentation registry is exhaustive over every enumerated code
    When a new code is added to the TypeScript app
    Then the suite fails first, because the code is raised but not enumerated
      # the compiler cannot see a code that is nowhere in the list — nothing
      # in the type system reflects over "every HandledError subclass"
    And once it is enumerated, the project fails to type-check until its copy
      is written

  @unit @bdd @handled-errors @presentation
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

  @unit @bdd @handled-errors @presentation
  Scenario: The raw-message habit cannot grow back
    Given error toasts must be raised through the shared helper
    When a call site renders an error's raw message into a toast instead
    Then the suite fails and names the file and line
      # a type cannot catch this: `error.message` is a perfectly good string

Feature: Langy's worker-side delete gate
  As the operator of the Langy worker
  I want every destructive LangWatch command to be held until a genuine,
    freshly-given, correctly-bound user confirmation is on record
  So that Langy cannot delete data on an accidental instruction, a
    self-authored "confirmation", a stale or mismatched "yes", or a command
    shape the matcher does not yet recognise

  # This worker-side gate is defense-in-depth against accidental and
  # naively-injected deletes; it is not a guarantee against an adversarial
  # agent with repo write access, for which only a server-side confirmation
  # token at the credential boundary suffices.
  #
  # The gate registers on pi's `tool_call` veto and evaluates every candidate
  # command against `ctx.sessionManager.getBranch()` fresh on each call — all
  # binding and single-use state is derived from branch history, never from
  # gate-local memory, so the gate is stateless across worker restarts.
  #
  # Companion spec:
  #   - specs/langy/langy-pi-harness.feature (harness selection this
  #     extension rides on top of)
  #
  # Source: issue #7608, planning comment Revision 3 (24 ACs).

  Rule: A confirmation must follow a real, in-order "ask, then act" exchange

    @unit
    Scenario: No confirmation anywhere blocks a destructive delete
      Given branch history contains zero user-authored assent
      When a gated bash command deletes a LangWatch resource
      Then the gate returns allow:false

    @unit
    Scenario: A leading "yes" with no preceding assistant ask is not confirmation
      Given the only user turn opens with an affirmative
      And no assistant turn before it named a delete
      When a gated bash command deletes a LangWatch resource
      Then the gate returns allow:false

    @unit
    Scenario: A stale confirmation does not carry forward across intervening assistant turns
      Given a valid confirm was followed by one or more assistant turns
      And no fresh user turn followed those assistant turns
      When a gated bash command deletes a LangWatch resource
      Then the gate returns allow:false

  Rule: The confirmation must be genuinely user-authored (the #7562 self-authored bypass)

    @unit
    Scenario: An assistant-authored or extension-injected affirmative is not confirmation
      Given the only affirmative in history is on a role "assistant" or role "custom" turn
      When a gated bash command deletes a LangWatch resource
      Then the gate returns allow:false

    @unit
    Scenario: An affirmative inside the resume-seed digest is not read as user assent
      Given a user turn whose only affirmative text appears before the
        "[End of digest. The user's current message follows.]" marker
      When a gated bash command deletes a LangWatch resource
      Then the gate returns allow:false

  Rule: A confirmation authorizes exactly the (resource-type, identifier) it followed

    @unit
    Scenario: A bound confirmation authorizes the single delete it followed
      Given the assistant's prior turn named deleting dashboard "d1"
      And the user's immediately following turn is an affirmative
      When a gated bash command deletes dashboard "d1"
      Then the gate returns allow:true

    @unit
    Scenario Outline: A confirmed delete does not authorize a mismatched target
      Given the assistant's prior turn named deleting dashboard "d1"
      And the user's immediately following turn is an affirmative
      When a gated bash command deletes <mismatched-target>
      Then the gate returns allow:false

      Examples: Same resource type, different identifier
        | mismatched-target  |
        | dashboard "d2"     |

      Examples: Same identifier, different resource type
        | mismatched-target  |
        | dataset "d1"       |

    @unit
    Scenario: A confirmation is consumed on its first authorized delete
      Given a bound confirmation for dashboard "d1" already authorized one delete of it
      And no fresh confirmation followed
      When a gated bash command deletes dashboard "d1" again
      Then the gate returns allow:false

    @unit
    Scenario: A multi-target command with only one target confirmed is blocked entirely
      Given only dashboard "d1" was confirmed
      When a gated bash command runs "langwatch dashboard delete d1 && langwatch dataset delete d2"
      Then the gate returns allow:false

  Rule: Ordinary, non-destructive, and unrelated commands are never blocked

    @unit
    Scenario Outline: Read-only langwatch CLI calls pass without confirmation
      When a gated bash command runs "<command>"
      Then the gate returns allow:true

      Examples:
        | command                                   |
        | langwatch dataset list                    |
        | langwatch prompt list                     |
        | langwatch traces list --limit 10           |

    @unit
    Scenario Outline: Non-langwatch bash commands pass without confirmation
      When a gated bash command runs "<command>"
      Then the gate returns allow:true

      Examples:
        | command          |
        | git status       |
        | ls -la /tmp      |
        | pnpm test:unit   |

    @unit
    Scenario: A block reason for an unconfirmed delete tells the agent to ask first
      Given a gated bash command deletes a LangWatch resource with no confirmation on record
      When the gate returns allow:false
      Then the reason names that data would be deleted
      And the reason matches /confirm/i

    @unit
    Scenario: A block reason for an unresolvable command tells the agent how to re-issue it
      Given a gated bash command is unparseable
      When the gate returns allow:false
      Then the reason matches /re-issue/i

  Rule: A command the matcher cannot resolve is held unconditionally, before the confirmation check

    @unit
    Scenario: A write or edit whose content contains a destructive command is held
      Given a bound, valid confirmation is present for the same target
      When a "write" or "edit" tool call's content contains a destructive langwatch command
      Then the gate returns allow:false
      # Held before the confirmation check ever runs — no confirmation can release it.

    @unit
    Scenario Outline: Executing an agent-written file is held even with a valid confirmation
      Given a bound, valid confirmation is present for the same target
      When a gated bash command runs "<command>"
      Then the gate returns allow:false

      Examples:
        | command       |
        | bash f.sh     |
        | sh f.sh       |
        | source f.sh   |
        | . f.sh        |
        | ./f.sh        |

  Rule: The HTTP matcher catches destructive intent beyond the literal DELETE verb, without over-blocking reads

    @unit
    Scenario: A POST GraphQL delete or archive mutation to a langwatch host is held
      When a gated command sends a POST GraphQL mutation deleting or archiving a resource to a langwatch API host
      Then the gate returns allow:false

    @unit
    Scenario: A PUT or PATCH soft-delete to a langwatch host is held
      When a gated command sends a PUT or PATCH soft-delete request to a langwatch API host
      Then the gate returns allow:false

    @unit
    Scenario: A POST to a destructive action endpoint on a langwatch host is held
      When a gated command sends a POST to a "/purge" action endpoint on a langwatch API host
      Then the gate returns allow:false

    @unit
    Scenario: A GET request to a langwatch host is not blocked
      When a gated command sends a GET request to a langwatch API host
      Then the gate returns allow:true

    @unit
    Scenario: A read or non-destructive GraphQL POST to a langwatch host is not blocked
      When a gated command sends a POST GraphQL "query {…}" document, or a non-destructive mutation such as create or rename, to a langwatch API host
      Then the gate returns allow:true

  Rule: The verb matcher is complete across flag forms, case, and the live command catalogue

    @unit
    Scenario: An equals-form flag value carrying a destructive verb is matched
      When a gated bash command runs "langwatch dashboard --x=delete d1"
      Then the gate returns allow:false

    @unit
    Scenario: A destructive verb matches regardless of case
      When a gated bash command runs "langwatch dashboard DELETE d1"
      Then the gate returns allow:false

    @unit
    Scenario: The verb canary red-fails on a catalog leaf verb classified as neither destructive nor reviewed-benign
      Given every leaf verb in the CLI's generated command catalog
      When the canary checks each leaf verb against DESTRUCTIVE_VERBS and an explicit REVIEWED_BENIGN allowlist
      Then a verb absent from both lists fails the canary
      And the canary passes only when every catalog leaf verb is classified

  Rule: Every model-reachable tool is gated or provably cannot reach a destructive operation

    @unit
    Scenario: Every enabled tool is classified as gated or exempt
      Given the full ENABLED_TOOLS set: read, bash, edit, write, grep, find, ls, todowrite, skill
      When each tool is checked against the gate
      Then bash, write, and edit are routed through the gate
      And read, grep, find, ls, todowrite, and skill are provably unable to reach a destructive LangWatch operation
      And user_bash / emitUserBash is confirmed absent from ENABLED_TOOLS by grep

  Rule: The gate proves itself at the real pi tool_call seam, not only in unit isolation

    @integration
    Scenario Outline: Each unconfirmed bypass class is blocked at the real tool_call seam
      Given the delete gate is registered on a real pi AgentSession
      When <bypass-case> is driven through the real "tool_call" event
      Then the event result blocks the call
      And the underlying tool does not execute

      Examples:
        | bypass-case                                          |
        | an unconfirmed CLI delete                            |
        | a write-then-exec sequence                            |
        | an HTTP-shape delete                                  |
        | a "--x=delete" equals-form command                    |
        | a confirm-A-delete-B mismatch                          |

    @integration
    Scenario: A self-authored affirmative injected through the extension API does not confirm
      Given the delete gate is registered on a real pi AgentSession
      When an agent-authored affirmative is injected through the real extension/agent message API
      And a gated delete is then driven through the real "tool_call" event
      Then the event result blocks the call and the tool does not execute
      And reading the injected turn back from getBranch() shows role is not "user"

    @integration
    Scenario: A correctly confirmed delete executes exactly once at the real seam
      Given the delete gate is registered on a real pi AgentSession
      And a bound confirmation for the target is on record
      When the confirmed delete is driven through the real "tool_call" event
      Then the event result allows the call
      And the tool executes exactly once

    @integration
    Scenario: An unreadable session history fails closed
      Given the delete gate is registered on a real pi AgentSession
      And sessionManager.getBranch() throws when called
      When a gated delete is driven through the real "tool_call" event
      Then the event result blocks the call
      And the tool does not execute

  Rule: The gate rests on undocumented pi SDK contracts, so a canary guards them directly

    @integration
    Scenario: The SDK canary guards block-on-return, throw-blocks-execution, and role-persistence
      Given the pinned "@earendil-works/pi-coding-agent" SDK version
      Then a "tool_call" handler returning block:true prevents the tool from executing
      And a handler throw also prevents the tool from executing
      And a message injected through the agent/extension API is read back from getBranch() with role other than "user"
      And the canary red-fails if any of these three properties changes on a version bump

  Rule: The on/off flag reaches the worker and changes real behavior end-to-end

    @unit
    Scenario: The flag resolves ON by default and falls back safely on a flag-store error
      Given "release_langy_delete_gate" is not explicitly configured
      When the flag is resolved server-side
      Then it resolves to ON
      And a flag-store error also resolves to ON, mirroring LANGY_PI_HARNESS_FLAG's fallback

    @integration
    Scenario: The flag off allows a destructive command through the real seam
      Given a worker is booted with "release_langy_delete_gate" off
      When an unconfirmed destructive bash command is driven through the real "tool_call" event
      Then the event result allows the call
      # Non-goal: flip latency. An already-warm worker keeps its booted value
      # until the next warm/probe-MISS re-warm.

    @integration
    Scenario: The flag on blocks the same destructive command through the real seam
      Given a worker is booted with "release_langy_delete_gate" on
      When the same unconfirmed destructive bash command is driven through the real "tool_call" event
      Then the event result blocks the call

  Rule: The spec itself is bound to real tests, not merely descriptive

    @unit
    Scenario: check-feature-parity reports this file's scenarios as bound, not vacuous
      Given every @unit and @integration scenario in this file
      When check-feature-parity.ts runs
      Then each scenario resolves to at least one covering test via a "@scenario" annotation
      And the report is not the vacuous "0/0 · all bound" case

# --- AC Coverage Map ---
# AC 1: "Golden-negative: no confirmation anywhere -> blocked" -> Scenario: No confirmation anywhere blocks a destructive delete
# AC 2: "Leading yes with no preceding assistant ask -> blocked" -> Scenario: A leading "yes" with no preceding assistant ask is not confirmation
# AC 3: "Stale confirmation -> blocked" -> Scenario: A stale confirmation does not carry forward across intervening assistant turns
# AC 4: "Assistant-authored confirmation -> blocked" -> Scenario: An assistant-authored or extension-injected affirmative is not confirmation
# AC 5: "Affirmative inside the resume-seed digest -> blocked" -> Scenario: An affirmative inside the resume-seed digest is not read as user assent
# AC 6: "Binding, stated operationally" -> Scenario: A bound confirmation authorizes the single delete it followed
# AC 7: "Mismatch: confirm A, delete B -> blocked" -> Scenario Outline: A confirmed delete does not authorize a mismatched target
# AC 8: "Single-use: consumed on first gated allow" -> Scenario: A confirmation is consumed on its first authorized delete
# AC 9: "Multi-target in one command, partial confirm -> blocked" -> Scenario: A multi-target command with only one target confirmed is blocked entirely
# AC 10: "Read-only langwatch calls pass" -> Scenario Outline: Read-only langwatch CLI calls pass without confirmation
# AC 11: "Non-langwatch bash passes" -> Scenario Outline: Non-langwatch bash commands pass without confirmation
# AC 12: "Block reason is actionable" -> Scenario: A block reason for an unconfirmed delete tells the agent to ask first; Scenario: A block reason for an unresolvable command tells the agent how to re-issue it
# AC 13: "Write-then-execute is held unconditionally" -> Scenario: A write or edit whose content contains a destructive command is held; Scenario Outline: Executing an agent-written file is held even with a valid confirmation
# AC 14: "Destructive HTTP beyond literal DELETE is held" -> Scenario: A POST GraphQL delete or archive mutation...; Scenario: A PUT or PATCH soft-delete...; Scenario: A POST to a destructive action endpoint...; Scenario Outline: Each unconfirmed bypass class is blocked at the real tool_call seam (HTTP-shape delete case)
# AC 15: "Benign HTTP to a langwatch host is NOT over-blocked" -> Scenario: A GET request to a langwatch host is not blocked; Scenario: A read or non-destructive GraphQL POST to a langwatch host is not blocked
# AC 16: "Equals-form flag values are evaluated" -> Scenario: An equals-form flag value carrying a destructive verb is matched; Scenario Outline: Each unconfirmed bypass class is blocked at the real tool_call seam (equals-form case)
# AC 17: "Case-insensitive + new-verb classification is forced by canary" -> Scenario: A destructive verb matches regardless of case; Scenario: The verb canary red-fails on a catalog leaf verb classified as neither destructive nor reviewed-benign
# AC 18: "Every model-reachable destructive path is gated or provably cannot be one" -> Scenario: Every enabled tool is classified as gated or exempt
# AC 19: "Real-seam use-proof across every bypass class" -> Scenario Outline: Each unconfirmed bypass class is blocked at the real tool_call seam; Scenario: A self-authored affirmative injected through the extension API does not confirm; Scenario: A correctly confirmed delete executes exactly once at the real seam
# AC 20: "Fail-closed when history is unreadable" -> Scenario: An unreadable session history fails closed
# AC 21: "SDK canary guards the undocumented contracts" -> Scenario: The SDK canary guards block-on-return, throw-blocks-execution, and role-persistence
# AC 22: "On/off flag reaches the worker and changes behavior end-to-end" -> Scenario: The flag resolves ON by default and falls back safely on a flag-store error; Scenario: The flag off allows a destructive command through the real seam; Scenario: The flag on blocks the same destructive command through the real seam
# AC 23: "Spec is bound, not vacuous" -> Scenario: check-feature-parity reports this file's scenarios as bound, not vacuous
# AC 24: "Threat-model boundary is stated as a load-bearing sentence" -> Feature description header (verbatim sentence, exact-string grep against this file and the PR body)

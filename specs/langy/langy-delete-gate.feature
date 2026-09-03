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

  Rule: A confirmation authorizes exactly the (verb, resource-type, identifier) it followed

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
    Scenario: A confirmed delete does not authorize a different destructive verb on the same target
      Given the assistant's prior turn named deleting dashboard "d1"
      And the user's immediately following turn is an affirmative
      When a gated bash command archives dashboard "d1"
      Then the gate returns allow:false
      # The confirmation binds the verb: a "yes" to delete authorizes only delete.

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
    Scenario: A quoted or escaped argument is not over-blocked, even with word-internal splices
      Given a command whose only quote, backslash, or brace splices are in
        ARGUMENTS, not the command name (`git commit -m "don't crash"`,
        `grep -rn 'foo"bar' .`, `sed 's/foo"bar"baz/qux/' f.txt`)
      When the gated bash command runs
      Then the gate returns allow:true
      # Splice detection is scoped to the command-name/head token; an
      # argument-position splice is not a CLI-name obfuscation and must not hold
      # the segment — that over-block is what gets the whole gate flag-disabled.

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

    @unit
    Scenario: An obfuscated command-name block names the obfuscation and says to re-issue the name plainly
      Given a gated bash command whose command name is spliced by quotes, a
        backslash, or a brace group
      When the gate returns allow:false
      Then the reason names the command name as obfuscated
      And the reason matches /re-issue/i
      # The specific cause is surfaced instead of the generic four-cause list, so
      # the agent fixes the command name rather than guessing.

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

    @unit
    Scenario: An interpreter running code that builds a destructive command at runtime is held
      Given a bound, valid confirmation is present for the same target
      When a gated bash command runs a code interpreter with inline code that concatenates a destructive langwatch command at runtime
      Then the gate returns allow:false
      # Interpreter-executed code is lexically unresolvable — held like write-then-exec.

    @unit
    Scenario: Every enumerated code interpreter is held whether it runs inline code, a script file, or bare stdin
      Given the CODE_INTERPRETERS set
      When each interpreter heads a gated bash command as inline code, a script file, or a bare stdin-reading invocation
      Then the gate returns allow:false for every one
      # A new interpreter missing from the set is the only way to pass — a conscious omission the canary surfaces.

    @unit
    Scenario: An interpreter behind a runner or env preamble is still held
      When a gated bash command runs a code interpreter behind a runner wrapper or an env-assignment preamble
      Then the gate returns allow:false

    @unit
    Scenario: A write or edit whose content embeds an interpreter invocation is held
      Given a bound, valid confirmation is present for the same target
      When a "write" or "edit" tool call's content runs a destructive langwatch command through a code interpreter
      Then the gate returns allow:false

    @unit
    Scenario: A bash native quote-splice that reassembles the CLI name is held
      Given a command where quotes splice word text on both sides
        (`lang""watch`, `l"w"`, `lang''watch`), which bash resolves to a real
        langwatch or lw invocation
      When the spliced command deletes a LangWatch resource
      Then the gate returns allow:false
      # Held as unresolvable — the literal langwatch/lw is never contiguous statically.

    @unit
    Scenario: A backslash- or brace-spliced command name that reassembles the CLI name is held
      Given a command where a backslash escape or a word-internal brace group
        splices the command name (`lang\watch`, `l\w`, `lang{,}watch`), which
        bash resolves to a real langwatch or lw invocation
      When the spliced command deletes a LangWatch resource
      Then the gate returns allow:false
      # Same class as the quote-splice: bash collapses the head token to
      # langwatch/lw, so the literal is never contiguous statically and the
      # obfuscated command name is held with a targeted re-issue reason.

    @unit
    Scenario: An awk program that concatenates a destructive command through system() is held
      Given an awk, gawk, or mawk program that builds "langwatch" at runtime by
        string concatenation inside system()
      When the program is run as a gated bash command
      Then the gate returns allow:false
      # awk is in CODE_INTERPRETERS: system() plus native concat is the awk twin of the Python concat bypass.

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

    @unit
    Scenario: A destructive HTTP block tells the agent to re-issue through the CLI, not to confirm
      Given a destructive HTTP call to a langwatch host that no confirmation can bind
      When the gate returns allow:false
      Then the reason says the HTTP call cannot be authorized and to re-issue it as a plain langwatch CLI command
      And the reason matches /re-issue/i
      # An http match is never confirmation-bindable, so the reason must not send
      # the user into a confirm-and-retry loop on the same curl.

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
    Scenario: A parallel-dispatch race cannot reuse one confirmation for two deletes
      Given the delete gate is registered on a real pi AgentSession
      And a bound confirmation for the target is on record
      When two destructive tool_call events are driven back-to-back with no tool result between them
      Then the first is allowed and the second is blocked
      # Single-use holds even when both calls prepare before either result lands.

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
# AC 10: "Read-only langwatch calls pass" -> Scenario Outline: Read-only langwatch CLI calls pass without confirmation; Scenario: A quoted or escaped argument is not over-blocked, even with word-internal splices
# AC 11: "Non-langwatch bash passes" -> Scenario Outline: Non-langwatch bash commands pass without confirmation
# AC 12: "Block reason is actionable" -> Scenario: A block reason for an unconfirmed delete tells the agent to ask first; Scenario: A block reason for an unresolvable command tells the agent how to re-issue it; Scenario: An obfuscated command-name block names the obfuscation and says to re-issue the name plainly; Scenario: A destructive HTTP block tells the agent to re-issue through the CLI, not to confirm
# AC 13: "Write-then-execute is held unconditionally" -> Scenario: A write or edit whose content contains a destructive command is held; Scenario Outline: Executing an agent-written file is held even with a valid confirmation; Scenario: A bash native quote-splice that reassembles the CLI name is held; Scenario: A backslash- or brace-spliced command name that reassembles the CLI name is held; Scenario: An awk program that concatenates a destructive command through system() is held
# AC 14: "Destructive HTTP beyond literal DELETE is held" -> Scenario: A POST GraphQL delete or archive mutation...; Scenario: A PUT or PATCH soft-delete...; Scenario: A POST to a destructive action endpoint...; Scenario: A destructive HTTP block tells the agent to re-issue through the CLI, not to confirm; Scenario Outline: Each unconfirmed bypass class is blocked at the real tool_call seam (HTTP-shape delete case)
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

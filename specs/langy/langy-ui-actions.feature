# The agent driving the page the user has open, through typed UI actions.
#
# The channel: `langwatch ui call <kind> --payload '<json>'` (run by the agent
# inside its worker, authenticated with its per-conversation session key) hits
# POST /api/langy/ui/actions; the server validates the kind against the page's
# action manifest and the payload against that kind's schema, pins the action
# to the conversation's ACTIVE turn in Redis, and publishes it on that turn's
# live stream — the same live-only channel `navigate` rides. The open page
# claims the action (first claim wins), executes the page-registered handler
# against its own store, and reports the result back; the dispatching HTTP
# call returns that result to the CLI in the same request.
#
# Fallback behavior when no page is attached is specified separately in
# langy-ui-actions-fallback.feature.
Feature: Langy drives the open page through typed UI actions

  @unit
  Scenario: Agent invokes a workbench action and the attached browser applies it live
    Given the user has the workbench open and an agent turn is running
    When the agent runs langwatch ui call workbench.duplicateTarget
    Then the page claims the action and applies it through the workbench store

  @unit
  Scenario: The action's result returns to the agent within the same CLI call
    Given the page executed a dispatched action
    When the page reports the action's result
    Then the dispatching CLI call prints that result marked as executed in the browser

  @unit
  Scenario: A replayed stream entry executes the action only once
    Given the turn stream re-delivered an action entry after a reconnect
    When the page sees the same action id again
    Then it drops the replay before ever claiming

  @unit
  Scenario: With two tabs open, only the claiming tab executes
    Given two tabs show the same conversation
    When both react to the same dispatched action
    Then exactly one claim succeeds and the other tab drops silently

  @unit
  Scenario: A page without a handler leaves the action unclaimed
    Given the user's open page does not handle the dispatched kind
    When the action entry reaches it
    Then the page does not claim, leaving the server free to fall back

  @integration
  Scenario: With page control rolled back, the open page ignores dispatched actions
    Given agent-driven page control is switched off for my project
    When a dispatched action reaches my open page
    Then the page does not claim it, and nothing on the page changes

  @unit
  Scenario: With page control rolled back, the agent is never offered the ui commands
    Given agent-driven page control is switched off for my project
    When I send a turn from a page that accepts UI actions
    Then the turn does not tell the agent about the ui commands
    And the agent is still told what I am looking at

  @unit
  Scenario: An action outside a running turn is refused
    Given the conversation has no turn in flight
    When the agent dispatches an action
    Then the dispatch is refused with langy_ui_turn_inactive

  @unit
  Scenario: An unknown action kind is refused with langy_ui_action_unknown
    When the agent dispatches a kind no page manifest declares
    Then the dispatch is refused before anything reaches the stream

  @unit
  Scenario: A payload failing its schema is refused with langy_ui_payload_invalid
    When the agent dispatches a payload the action's schema rejects
    Then the dispatch is refused before anything reaches the stream

  @unit
  Scenario: A conversation id from another project is refused without confirming it exists
    When the agent names a conversation the session key's owner cannot see
    Then the dispatch answers not found, the same as for no conversation at all

  @unit
  Scenario: An unclaimed action deletes its pending record before answering
    Given nothing claimed the action inside the claim window
    When the dispatch gives up on the page
    Then the pending record is deleted first, so a late claim finds nothing

  @unit
  Scenario: A tab claiming as the dispatch gives up never double-executes
    Given nothing claimed the action inside the claim window
    When a tab claims while the dispatch hands the action to the backend
    Then the claim is refused and only the backend runs the action

  @unit
  Scenario: A claimed action that never completes times out without re-dispatching
    Given a page claimed the action and went silent
    When the action's execute budget runs out
    Then the agent gets langy_ui_timeout and the action is never re-dispatched

  @unit
  Scenario: A browser handler failure reaches the agent as langy_ui_handler_failed and the user as a toast
    Given the page's handler threw while applying the action
    When the page reports the failure
    Then the agent reads the handler's own error code and the user sees a toast
    And the refusal counts as the caller's fault, not the platform's

  @unit
  Scenario: An unexplained handler failure stays a platform fault
    Given the page's handler threw something that named no error code
    When the page reports the failure
    Then the agent reads the generic code and the failure counts as the platform's fault

  @unit
  Scenario: A result over the ceiling is measured by its encoded bytes
    Given the page reports a result of multi-byte characters
    When the result is over the size ceiling once encoded
    Then the agent gets result_too_large instead of the payload

  @unit
  Scenario: A claim naming a different turn than the dispatch pinned is refused
    When a claim arrives for another project, conversation or turn
    Then it is refused exactly like a claim for an unknown action

  @unit
  Scenario: Only the claiming user's session may complete an action
    Given one user's session claimed the action
    When a different session reports a completion
    Then the completion is dropped and the claimant's completion still lands

  @unit
  Scenario: The worker env carries the conversation id for the UI channel
    Given a worker is spawned for a conversation on either harness
    Then its environment names that conversation for the CLI's ui call

  @unit
  Scenario: A run scoped to a target and a row subset covers only those cells
    Given the agent dispatches workbench.run naming one target and a row subset
    When the run starts on either the browser or the backend path
    Then only that target's cells for those rows execute
    And neither filter is silently dropped in favor of the other

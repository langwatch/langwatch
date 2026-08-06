Feature: AI Gateway virtual key creation
  As someone handing out access to models
  I want to say who the key belongs to, what it may spend, what it may reach,
  and what happens when a provider fails
  So that a key is a decision I can explain rather than a form I guessed at

  # Background
  #
  # The drawer used to ask for a "scope", which conflated three different
  # things: which providers the key could reach, who could see the key, and
  # where its traces landed. The last of those was never stated at all: an
  # organization- or team-owned key silently resolved to the organization's
  # governance project, or to nothing, in which case the gateway had nowhere
  # to send the key's traces and dropped them. A key whose traces are dropped
  # has no cost record, no usage, and no budget that can ever accrue against
  # it, and nothing on the screen said so.
  #
  # So the key states its consequences: where it lives and where its traces
  # land, what it may spend, which providers it may reach, and whether it
  # fails over. Ordered that way, because that is the order the decisions
  # actually get made in. And "nowhere" is no longer a place traces can
  # land: every key must resolve a project for its traces and costs,
  # because that is the feed every budget accrues from.

  Background:
    Given organization "acme" with team "platform" and project "web-app"
    And I may create virtual keys in "acme"

  # ============================================================================
  # Where the key lives, and where its traces land
  # ============================================================================

  @integration
  Scenario: The drawer states where this key's traces and costs will land
    When I choose to create a key owned by project "web-app"
    Then the drawer tells me its traces and costs land in "web-app"

  @integration
  Scenario: A key owned above a project is refused until its traces have a home
    When I try to create a key owned by organization "acme" with nowhere for its traces to land
    Then the key is refused
    And the refusal says its spend could not be capped
    # "Untraced" used to be offered here as a choice, with a sentence
    # disclosing what it cost. But spend accrual is fed by traces: an
    # untraced key accrues nothing against any budget, including the
    # organization's own cap, no matter how much it spends. That is not a
    # trade-off to disclose, it is an enforcement hole, and a sentence on a
    # form does not close it. The same refusal applies to a key owned by a
    # team.

  @integration
  Scenario: The governance inbox is a home for a shared key's traces
    Given organization "acme" has a governance inbox and no other project
    When I create a key owned by organization "acme"
    Then its traces and costs land in the governance inbox
    # A shared key does not need a hand-picked project when there is no
    # other project to pick: the governance inbox is a real destination and
    # spend accrues from it.

  @integration
  Scenario: A shared key must say where its traces land once there is a choice
    Given organization "acme" has a governance inbox and a project "web-app"
    When I create a key owned by organization "acme" without saying where its traces land
    Then the key is refused for not saying where its traces land
    # Falling back to the inbox keeps the spend visible, and puts it under
    # a project nobody named. Every budget on the project the creator had
    # in mind then counts none of this key's traffic while both sides look
    # correctly configured. The app has always required the destination
    # here; this is the API agreeing with it.

  @integration
  Scenario: A key that reaches several projects must pick one for its traces
    Given organization "acme" has projects "web-app" and "batch"
    When I create a key scoped to both without saying where its traces land
    Then the key is refused for not saying where its traces land
    # The key named two destinations, so attributing its spend to a third
    # is the one answer that is certainly wrong.

  @integration
  Scenario: A key says which rule decides where its traces land
    Given keys that name a project, take one from their scope, and name none
    When each is read back
    Then each says which of the three put its traces where they went
    # A key attributed to the governance inbox reads identically to a
    # correctly scoped one on every other field. This is what tells the
    # legacy shape apart without opening the app.

  @integration
  Scenario: A key cannot be updated into dropping its traces
    Given a key owned by project "web-app"
    When I move it above the project without giving its traces a home
    Then the update is refused
    And the key keeps landing its traces in "web-app"

  @integration
  Scenario: A key that predates this rule must be given a home before it changes
    Given a key created before this rule whose traces land nowhere
    When I try to change anything about it
    Then the update is refused until its traces are given a home
    But revoking it still works
    # The next touch closes the hole. Renaming a key that cannot be capped
    # would keep the hole alive indefinitely; revocation stays open because
    # killing the key closes it the other way.

  # ============================================================================
  # What the key may spend
  # ============================================================================

  @integration
  Scenario: Creating a key with a budget creates both or neither
    When I create a key with a limit of $30 per day
    Then the key exists with that budget already attached
    And the gateway is told about the budget as part of the key's configuration
    # One transaction. A key that exists for even a moment without the cap
    # its creator asked for is a key that can spend without one.

  @integration
  Scenario: An empty budget field means no cap, and says so
    When I leave the budget field empty
    Then the drawer tells me there is no maximum spend for this key
    And no budget is created

  @integration
  Scenario: A filled budget states its limit, its period and when it resets
    When I set a limit of $30 per day
    Then the drawer states the maximum and the time the period resets
    And it says that reset happens in UTC
    And it offers no timezone choice
    # The reset time is the one piece of copy on this form that is worth
    # spelling out: "resets at midnight" is a different promise in each
    # timezone, and the wrong assumption is only discovered by being billed.
    # Resets are computed in UTC only (budgetWindow.ts); a timezone picker
    # would display a promise enforcement does not keep. The control comes
    # back with the budgets.feature "windows honor org-configured timezone"
    # scenario, which is still unimplemented.

  @integration
  Scenario: Removing a key's budget from the drawer archives it
    Given a key with a budget
    When I clear the budget field
    Then the budget stops applying to the key
    And the budget row is kept
    # Archived, never deleted: the spend recorded against it is the audit
    # trail of what the key cost, and deleting the budget throws that away.

  @integration
  Scenario: Revoking a key retires its budget instead of deleting it
    Given a key with a budget
    When the key is revoked
    Then its budget no longer applies
    And the budget row is kept with its spend history

  @integration
  Scenario: The drawer lists the budgets that already constrain this key
    Given the organization has a monthly budget
    And project "web-app" has a monthly budget
    When I create a key owned by project "web-app"
    Then the drawer lists both budgets with their limit, period and current spend
    And a budget that counts one provider only says which
    And a per-member group budget says that its limit is per person
    # Resolved by the same code that decides what the gateway enforces, so
    # the list cannot promise a constraint that will not apply, or miss one
    # that will.

  # ============================================================================
  # Which providers the key may reach
  # ============================================================================

  @integration
  Scenario: Allowing all providers keeps future providers included
    When I create a key allowing all providers
    And a new provider is added to the organization later
    Then the key can reach the new provider without being edited
    # "All" is stored as the absence of a list, which is what makes it mean
    # all current AND future providers rather than a snapshot of today's.

  @integration
  Scenario: An explicit provider list narrows what the key can reach
    When I create a key allowing one specific provider
    Then the key can reach only that provider
    And a provider added later is not reachable by this key

  @integration
  Scenario: Unticking every provider is refused rather than saved
    When I untick every provider
    Then I cannot save the key
    # A key that can serve nothing is always a mis-click. The two states
    # worth having are "all" and "these ones".

  @integration
  Scenario: A key cannot be pointed at a provider it cannot reach
    When I submit a provider the key's ownership does not reach
    Then the key is refused
    # Otherwise the mistake only surfaces later as an unexplained "model not
    # available" on a request nobody can trace back to this form.

  # ============================================================================
  # What happens when a provider fails
  # ============================================================================

  @integration
  Scenario: A new key defaults to no fallback
    When I create a key without choosing a routing behaviour
    Then the key does not fail over to another provider
    # Failing over sends the request, and its data, to a different vendor.
    # That is a decision worth making on purpose rather than inheriting from
    # a blank field.

  @integration
  Scenario: A key with no fallback is dispatched at most once
    Given a key that does not fail over
    When its configuration reaches the gateway
    Then the gateway is told to attempt one provider only

  @integration
  Scenario: Routing mode and routing policy cannot contradict each other
    When I ask for a custom routing policy without naming one
    Then the key is refused
    And asking for no fallback while naming a policy is refused too

  @integration
  Scenario: Keys that existed before the routing choice keep failing over
    Given a key created before routing behaviour was an explicit choice
    When its configuration is read
    Then it still falls back across every provider it can reach
    # The old implicit default was fallback-across-everything. Existing keys
    # are pinned to it so nothing changes under a customer; only new keys
    # get the safer default.

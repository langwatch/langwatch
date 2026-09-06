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
  #
  # The destination is decided once, when the key is written, and stored on
  # the key. It used to be derived on every read, by trying the named
  # destination, then the key's single project scope, then the organization's
  # governance inbox. Three lookups, each of which had to remember that a
  # deleted project is not a destination, and one of which forgot. A stored
  # answer cannot disagree with itself.

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
  Scenario: A key owned by one project stores that project as its destination
    When I create a key owned by project "web-app"
    Then the key stores "web-app" as where its traces and costs land
    # The key's single access scope is the only destination it could mean,
    # so the answer is settled at creation rather than re-derived on every
    # read of the key.

  @integration
  Scenario: A key that names a destination stores the one it names
    Given organization "acme" has a governance inbox and a project "web-app"
    When I create a key owned by organization "acme" naming "web-app" for its traces
    Then the key stores "web-app" as where its traces and costs land

  @integration
  Scenario: The governance inbox is a home for a shared key's traces
    Given organization "acme" has a governance inbox and no other project
    When I create a key owned by organization "acme"
    Then the key stores the governance inbox as where its traces and costs land
    # A shared key does not need a hand-picked project when there is no
    # other project to pick: the governance inbox is a real destination and
    # spend accrues from it. It is a creation-time default now, not a rule
    # that re-answers on every read.

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
  Scenario: A destination that is named has to be one that exists
    Given organization "acme" and a project belonging to another organization
    When I create a key naming that project for its traces
    Then the key is refused because the project is not in this organization
    And no key is written
    # A destination that does not answer used to fall through to the next
    # rule, so the key was saved with its traffic attributed to whichever
    # rule picked up while its own stated destination said otherwise. There
    # is no next rule to fall through to now, and the write is refused.

  @integration
  Scenario: A project that was deleted is no longer a destination
    Given organization "acme" has projects "web-app" and "batch"
    And "batch" has since been deleted
    When I create a key naming "batch" for its traces
    Then the key is refused because the project is not in this organization
    And no key is written
    # Deleting a project archives it rather than removing the row, so a
    # destination that only has to exist and belong to the organization
    # still answers after the customer deleted it. The key would start out
    # exporting traces into a project they cannot open, and attributing its
    # spend there.

  @integration
  Scenario: A key scoped only to a deleted project cannot take it as a destination
    Given organization "acme" has a governance inbox and a deleted project "batch"
    When I create a key scoped to "batch" without saying where its traces land
    Then the key stores the governance inbox as where its traces and costs land
    # A scope is a claim about where traffic may go, not a licence to trace
    # into somewhere the customer removed. With no live project to take the
    # destination from, the inbox is the creation-time default.

  @integration
  Scenario: A key whose destination is deleted later keeps sending traces there
    Given a key owned by organization "acme" whose traces land in "batch"
    When "batch" is deleted
    Then the key still lands its traces in "batch"
    And its traffic is never refused for it
    # Deletion is soft, so the project row and its spend are intact and
    # reappear if the customer restores it. Rerouting the key would scatter
    # one key's history across two projects for an act performed on a
    # different screen, and failing the key would take its traffic down for
    # the same. The state is surfaced instead of acted on.

  @integration
  Scenario: A deleted destination is badged wherever the key is read
    Given a key whose stored destination has since been deleted
    When I open the key
    Then the destination is shown as deleted
    # The one thing a reader cannot work out for themselves: the project
    # name resolves, the traces arrive, and nothing else on the row says
    # that the project behind it is gone.

  @integration
  Scenario: A live destination reads back as present, not deleted
    Given a key whose destination is a project that still exists
    When I open the key
    Then the destination is not shown as deleted
    # The badge means something only if the ordinary case is quiet.

  @integration
  Scenario: An organization whose projects were all deleted can still create a shared key
    Given organization "acme" whose only projects are a governance inbox and a deleted one
    When I create a key owned by organization "acme" without saying where its traces land
    Then the key is created
    And the key stores the governance inbox as where its traces and costs land
    # The refusal for not naming a destination exists because there was one
    # worth naming. A deleted project is not one, so demanding a choice here
    # would refuse the key for not picking from an empty list, while every
    # project it could pick is itself refused as unknown.

  @integration
  Scenario: Moving a key above the project it was scoped to keeps its traces there
    Given a key owned by project "web-app"
    When I move it above the project without saying where its traces should land
    Then the key still lands its traces in "web-app"
    # This used to be refused, because the destination came from the scope
    # and the edit took the scope away. It comes from the key now, so the
    # edit takes nothing away and there is nothing to refuse.

  @integration
  Scenario: Clearing a key's destination is refused when it leaves nowhere for its traces
    Given a key owned by organization "acme" whose traces land in "web-app"
    When I clear where its traces land
    Then the update is refused for not saying where its traces land
    And the key keeps landing its traces in "web-app"
    # Clearing it asks for the destination to be worked out again from what
    # the key is now, which for a shared key in an organization with projects
    # to choose from is the same question creation refuses.

  @integration
  Scenario: Changing which teams a key is scoped to leaves its destination alone
    Given a key owned by organization "acme" whose traces land in "web-app"
    When I add team "platform" to what the key reaches
    Then the key still lands its traces in "web-app"
    # Editing who can reach a key used to be able to move where its money
    # was counted, because the destination was re-derived from the scopes
    # on every read. Two decisions, made on two screens, one of which never
    # mentioned the other. The destination moves only when it is set.

  @integration
  Scenario: Naming a new destination on an update moves it, and is validated the same way
    Given a key owned by organization "acme" whose traces land in "web-app"
    When I change its destination to "batch"
    Then the key lands its traces in "batch"
    But naming a deleted or foreign project is refused as it is on create

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
  # Giving the keys that already exist a stored destination
  # ============================================================================
  #
  # Every key written before the destination was stored carries whatever the
  # three rules would have answered for it. The backfill answers once, with
  # the same rules, and writes it down. It is deterministic and safe to run
  # twice: a key that already points at a live project is never touched.

  @integration
  Scenario: A key already pointing at a live project keeps that destination
    Given a key naming a project that still exists
    When the stored destinations are backfilled
    Then the key still names that project
    And running the backfill again changes nothing

  @integration
  Scenario: A key with no destination takes the project it is scoped to
    Given a key with no destination whose only access scope is a live project
    When the stored destinations are backfilled
    Then the key names that project
    # Exactly the answer the second rule gave it, made permanent.

  @integration
  Scenario: A key whose destination was deleted falls back to the governance inbox
    Given a key naming a project that has since been deleted
    When the stored destinations are backfilled
    Then the key names the organization's governance inbox
    # The chain answered the inbox for this key too, so its traces do not
    # move. From here on the pointer stays put even when the project it
    # names is deleted; this is the last time a deletion reroutes anything.

  @integration
  Scenario: A key in an organization with no governance inbox is left without one
    Given an organization with no governance inbox and a key with no destination
    When the stored destinations are backfilled
    Then the key still has no destination
    # There is nothing to write. It takes the same path it takes today: the
    # gateway skips span export rather than failing, and the next edit of
    # the key is refused until somebody gives it a home.

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
  Scenario: Revoking a key retires a cap that targets only that key
    Given a budget created on the budgets page that targets one key
    When that key is revoked
    Then the budget is retired too, because a revoked key can never spend again

  @integration
  Scenario: Revoking a key retires a per-end-user allowance anchored on it
    Given a per-end-user budget anchored on a key
    When that key is revoked
    Then the allowance is retired, because no further end user can be attributed to it

  @integration
  Scenario: Revoking a key leaves a project budget standing
    Given a project has a budget
    And a key scoped to that project
    When the key is revoked
    Then the project budget still applies, because another key can be scoped there

  @integration
  Scenario: Clearing the drawer budget leaves an independently created cap alone
    Given a key with a drawer budget
    And a budget created on the budgets page that targets the same key
    When the drawer budget field is cleared
    Then only the drawer budget is retired
    And the independently created cap still applies, because the key is still live

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

  # ============================================================================
  # When the key stops working
  #
  # A key handed to a contractor, a demo, or a test run has a natural end
  # date, and the way that ends today is that somebody remembers to revoke
  # it. The drawer asks for the date instead. "Never" stays the default,
  # because most keys are not temporary and a form that expires things by
  # accident is worse than one that never does.
  # ============================================================================

  @integration
  Scenario: The drawer offers an expiration and defaults to never
    When I choose to create a key
    Then the expiration choice reads "Never"
    And the key it creates has no expiration date

  @integration
  Scenario: Picking a period states the date the key stops working
    When I pick an expiration of 7 days
    Then the drawer shows me the resolved date in words
    And the created key carries that date
    # A period is easy to pick and impossible to check. The date is what
    # the reader has to be able to repeat back.

  @integration
  Scenario: A custom date expires the key at the end of that day
    When I pick a custom expiration date
    Then the key works for the whole of that day and stops after it
    # Picking "the 20th" and losing the key at midnight of the 19th is the
    # single most common way a date field surprises somebody.

  @integration
  Scenario: An expiration date in the past is refused
    When I try to create a key that expired before it was made
    Then the key is refused, naming the expiration field
    And the refusal tells me to pick a date in the future

  @integration
  Scenario: The expiration date is published on the key
    Given a key created with an expiration date
    When the key is read over the API
    Then it carries the expiration date
    And its status is still "active"
    # Expiry is a date, not a status value: adding an "expired" status to
    # the wire enum would break every client that switches on the three it
    # already knows, for a fact each of them can read off the date.

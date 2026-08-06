Feature: Gateway budget targeting
  As a platform engineer
  I want a gateway budget to apply to exactly one place with an unambiguous owner
  So that a budget's target and its tenancy can never become inconsistent

  # Background
  #
  # A gateway budget applies at one scope: an organization, a team, a
  # project, a group, a virtual key, or a principal. Historically the
  # target was
  # recorded in two places that had to be kept in lock-step (a canonical
  # scope plus a parallel set of typed columns guarded by a database CHECK
  # constraint), which created room for the two to disagree.
  #
  # ADR-021 makes the target a single inline scope on the budget, owned by
  # one organization. The duplicate typed columns, their cascade foreign
  # keys, and the CHECK constraint are removed; cleanup when a scoping
  # entity is deleted moves to the service layer. Budgets keep their own
  # six-tier set (organization, team, project, group, virtual key,
  # principal); those extra tiers are budget-only and are not part of the
  # shared three-tier scope contract. Budgets have no real production usage yet,
  # so the change can be aggressive.

  Background:
    Given an organization "acme" with a team "platform" and a project "web-app"

  # ────────────────────────────────────────────────────────────────────────────
  # One target, one owner
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: A budget applies to exactly one place
    When an admin creates a budget for team "platform"
    Then the budget applies to team "platform"
    And it does not apply to any other team, project, or key
    # Stored as a single inline scope; there is no second representation of
    # the target that could drift out of sync.

  @integration @unimplemented
  Scenario: A budget can target a single virtual key
    When an admin creates a budget for one virtual key
    Then the budget applies to that virtual key only
    But choosing a target in a model provider or default-model rule still cannot offer a virtual key
    # Budgets keep the budget-only virtual-key tier; the shared three-tier
    # contract used by other resources does not expose it.

  @unit @unimplemented
  Scenario: A request and its precomputed gateway config agree on which budgets apply
    Given budgets exist for the organization, the team, and the project a request runs under
    When the budgets that apply to that request are determined at request time
    And the budgets that apply are precomputed into the gateway config for the same request
    Then both agree on exactly the same set of budgets
    # One shared selection helper backs both paths so they cannot diverge.

  # ────────────────────────────────────────────────────────────────────────────
  # Tenancy
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: An organization only ever sees its own budgets
    Given another organization "globex" also has budgets
    When a member of "acme" views the gateway budgets
    Then only "acme" budgets are shown
    And no "globex" budget is ever returned
    # Every budget read is constrained to the caller's organization at the
    # data layer; an unconstrained read is rejected.

  @integration @unimplemented
  Scenario: A budget from another organization never limits this organization's traffic
    Given organization "globex" has a project-level budget
    When a request runs under project "web-app" in "acme"
    Then the "globex" budget is not applied to it

  # ────────────────────────────────────────────────────────────────────────────
  # Every dimension, and combinations of them
  # ────────────────────────────────────────────────────────────────────────────
  #
  # A budget answers two questions that are deliberately kept apart: WHO it
  # constrains (organization, team, project, group, person, virtual key)
  # and WHICH provider's spend it counts. Keeping the provider orthogonal is
  # what makes "$50 a month on OpenAI for the platform team" one budget
  # instead of a new kind of scope for every vendor.

  @integration
  Scenario: A provider-filtered budget only counts spend sent to that provider
    Given a budget on project "web-app" that counts only one provider's spend
    When a request is dispatched to a different provider
    Then that budget does not count it
    And a budget on the same project with no provider filter counts it
    # A dispatch whose provider is unknown counts only towards unfiltered
    # budgets: attributing it to a named provider would be a guess, and a
    # guess here mis-bills a spending control.

  @integration
  Scenario: Two budgets on the same target with different provider filters do not share spend
    Given project "web-app" has a budget counting every provider
    And project "web-app" also has a budget counting one provider only
    When spend is recorded against the unfiltered budget
    Then the filtered budget still reports nothing spent
    # The two accrue in separate buckets. Sharing one would make each report
    # the other's spend, and the tighter of the two would block on traffic it
    # was never meant to see.

  @integration
  Scenario: A group budget gives each member their own allowance
    Given a group "engineering" with members alice and bob
    And a budget on that group
    When alice's key is resolved
    Then the budget applies to alice with her own allowance
    And bob's spend does not count against it
    # "People in this group each get this much": one budget row, one
    # bucket per member. A shared pot for the group is a team or project
    # budget, which is a different question and already has an answer.

  @integration
  Scenario: A group budget does not apply to a key with no person behind it
    Given a budget on group "engineering"
    When a shared key that belongs to no one is resolved
    Then the group budget does not apply to it
    # There is nobody to charge the per-member allowance to. Silently
    # charging it to the whole group would turn a per-person cap into a
    # shared one the first time somebody made a service key.

  @integration
  Scenario: Leaving a group drops that member's allowance on the next resolve
    Given bob is in group "engineering" which has a budget
    When bob leaves the group
    Then the budget no longer applies to bob
    And it still applies to the members who remain
    # Membership is read when the key's configuration is resolved, so a
    # change takes effect on the next resolve rather than needing every
    # affected key to be edited.

  @integration
  Scenario: A group budget cannot be created where members' spend cannot be told apart
    Given a deployment that reads budget spend from the database fallback
    When an admin creates a budget on group "engineering"
    Then the budget is refused
    And the refusal says group budgets need the spend ledger
    # The fallback keeps one running spend figure per budget row. A
    # group budget is one bucket per member; squeezed into one figure
    # it would cap each member at what the whole group spent together,
    # which is a different promise than the one on the label. A control
    # that cannot mean what it says is refused rather than created.

  @integration
  Scenario: The gateway is told each budget's provider filter and per-member bucket
    Given a key covered by a provider-filtered budget and a group budget
    When its configuration is materialised for the gateway
    Then each budget carries the provider it counts, or nothing if it counts all
    And the group budget arrives as this member's own bucket
    # The gateway enforces from what it is told. A filter the bundle omits is
    # a filter that does not exist at request time.

  # ────────────────────────────────────────────────────────────────────────────
  # Cleanup when a scoping entity goes away
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Deleting a team retires its budget
    Given team "platform" has a budget
    When team "platform" is deleted
    Then its budget no longer applies to anything
    And no leftover budget keeps charging against the removed team
    # Cleanup runs in the service layer rather than via a database cascade.

  # ────────────────────────────────────────────────────────────────────────────
  # The MANUAL window and period resets
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: A MANUAL window never resets on its own
    Given a budget on the MANUAL window
    When its next reset instant is computed
    Then it is the never-resets sentinel
    And the automatic reset check always answers no
    # The period is owned by the customer's billing cycle: the boundary
    # moves only when they say so.

  @unit
  Scenario: The period floor follows the stored boundary, not the calendar
    Given a MANUAL budget and a calendar budget reset mid-period
    When each budget's spend-read floor is computed
    Then the MANUAL budget always reads from its stored boundary
    And the reset calendar budget reads from its boundary until the next calendar edge passes
    And an unreset lifetime budget keeps its whole-bucket read
    # The rollup fast path answers calendar periods only; a moved boundary
    # reads the raw ledger bounded by time.

  @integration
  Scenario: Resetting a budget moves the boundary and never the ledger
    Given a budget with recorded spend this period
    When the budget is reset
    Then its current-period spend reads as zero
    And every ledger row that existed before the reset still exists
    # Recorded spend is immutable; reconciliation and billing events are
    # unaffected by resets, unlike counter-zeroing designs.

  @integration
  Scenario: Resetting one end-user bucket leaves the template period alone
    Given an attributed-user template with spend from two end users
    When one end user's bucket is reset
    Then that user's current-period spend reads as zero
    And the other user's spend is unchanged
    And the template's own boundary did not move

  # ────────────────────────────────────────────────────────────────────────────
  # A budget reaches the traffic it names
  # ────────────────────────────────────────────────────────────────────────────
  #
  # Which team and project a request belongs to used to be read entirely
  # from where its traces land. That answers a different question, and for
  # a key that is not scoped to exactly one project it lands on the
  # organization's governance project. A team-scoped key therefore reported
  # the governance team, and a budget on the team that owns the key matched
  # nothing while both sides looked correctly configured.

  @unit
  Scenario: A key belongs to the teams it is scoped to
    Given a key scoped to team "platform" with no trace project of its own
    When the key's attribution scopes are resolved
    Then they include team "platform"
    And they still include the team its traces land in
    # Attribution is a set, not a single answer, so making it correct can
    # only add budgets that now match and can never stop one from matching.

  @integration
  Scenario: A team budget reaches a team-scoped key's traffic
    Given team "platform" has a budget and a key scoped to that team
    When the key completes a request
    Then the team budget records the spend
    # The configuration a customer would reach for first, which until now
    # accrued nothing at all.

  @integration @unimplemented
  Scenario: A budget no active key can reach is refused when it is created
    Given an organization whose keys all send traffic elsewhere
    When an admin creates a budget on a project none of them reach
    Then the budget is refused as unreachable
    And the refusal names where the organization's traffic actually goes
    # A budget that can never accrue is a silent failure with a bill
    # attached. Say so at the moment it is written.

  @integration @unimplemented
  Scenario: An admin can still create a budget before any key exists
    Given an organization with no active keys
    When an admin creates a budget on one of its projects
    Then the budget is created
    # Budget first, key second is the natural setup order, so an empty
    # organization must never be told its budget is unreachable.

  @integration @unimplemented
  Scenario: An admin can insist on a budget that nothing reaches yet
    Given an organization whose keys all send traffic elsewhere
    When an admin creates an unreachable budget and asks to keep it anyway
    Then the budget is created
    # Provisioning ahead of the keys that will use it is legitimate; the
    # refusal is a guardrail, not a prohibition.

Feature: Customer.io knows each team's real plan
  Lifecycle emails branch on plan, so Customer.io holds the plan billing resolved for each
  team, on its members and on its company. Billing's subscription_changed fact carries the
  plan; nurturing never reads billing (ADR-001). A renewal or a seat change records no fact.
  Nurturing folds each fact into its own plan copy, a peer fold over billing's facts keyed by the
  organization, and tells Customer.io, on a fact's live delivery, only the fact that won the copy.
  A deploy step fills the copy from billing's log and sends nothing: a replay runs no subscriber.

  Run the resync once the deploy's nurturing:replay-organization-members step is done, which fills
  the member copy from organization's member facts. If the resync runs first, it identifies no
  member without a member-copy row (the org's group call still carries the plan), so the wrong order
  sends nothing wrong. To repair it, run the resync again; skipped members otherwise get no plan
  until the next live fact.

  @unit
  Scenario: A started subscription tells Customer.io the plan on members and company
    Given an organization with two active members whose subscription became active on a paid plan
    When billing's subscription_changed fact for it is delivered
    Then each member is identified with that plan in lower case and has_subscription true
    And one group call carries the plan to the organization's admin

  @unit
  Scenario: A member current in another organization is not told this plan
    Given an organization with two active members, one of whom has their latest current membership in another organization
    When billing's subscription_changed fact for it is delivered
    Then only the other member is identified with the plan
    And the group call still carries the plan to the organization's admin

  @integration
  Scenario: A paid-to-paid change shows the new plan and never free
    Given an organization on an active tiered subscription
    When its seat-event subscription activates and the old one is marked cancelled
    And Stripe's delete for the old subscription arrives
    Then Customer.io is told the seat-event plan
    And no call carried the plan free
    And the delete is skipped as already cancelled

  @integration
  Scenario: Cancelling the last active subscription returns the organization to free
    Given an organization whose only active subscription is cancelled
    When the subscription_changed fact is delivered
    Then members and company show plan free and has_subscription false

  @integration
  Scenario: Cancelling one of two subscriptions keeps the other's plan
    Given an organization with two active subscriptions on different plans
    When one is cancelled
    Then members and company show the remaining subscription's plan

  @integration
  Scenario: A pending checkout does not make the plan paid
    Given an organization whose only non-cancelled subscription is pending payment
    When its subscription_changed fact is delivered
    Then the plan sent is free and has_subscription is false

  @integration
  Scenario: A renewal or a seat change tells Customer.io nothing
    Given an organization with an active subscription
    When Stripe reports a renewal or a seat quantity change
    Then Customer.io receives no call

  @unit
  Scenario: A subscription_changed fact stored before it carried a plan sends no plan
    Given a stored subscription_changed fact with no plan
    When it is delivered
    Then members are identified with has_subscription only and no plan trait is sent

  @unit
  Scenario: A new organization gets its name and creation time on its founder
    Given organization records a creation naming a founder
    When the created fact is delivered
    Then the founder gets one group call with the name and created_at in Unix seconds, and no plan
    And no signed_up track is sent

  @unit
  Scenario: An organization's creation landing after its founder's erasure sends nothing
    Given organization's creation fact names a founder who was erased
    When the fact lands late or is replayed
    Then Customer.io receives no call
    And one line with a count and no ids is logged

  @integration
  Scenario: A subscription fact naming an erased member tells them nothing
    Given billing's subscription fact names two members, one of them erased
    When it is delivered
    Then the admin gets the group call and only the other member is identified

  @unit
  Scenario: A provisioned organization with no founder sends nothing
    Given organization records a creation naming no founder
    When the created fact is delivered
    Then Customer.io receives no call
    And one line with a count and no ids is logged

  @unit
  Scenario: The sign-up path keeps its calls
    Given a person signs up with an organization
    When the signed_up signal is delivered
    Then the group call carries name, company_size and plan free as before

  @unit
  Scenario: The usage sync adds the company traits to its group call only
    Given a placed organization with 3 members and 2 projects, created at a known time
    When its usage syncs
    Then the group call carries project_count 2 and created_at in Unix seconds beside the usage traits
    And the mirrored member identifies carry neither

  @unit
  Scenario: Company traits nurturing does not know are left out
    Given company traits with no known creation time or project count
    When they are built for a group call
    Then they carry no created_at and no project_count, and no zero in their place

  @unit
  Scenario: An organization nurturing never placed still sends nothing
    Given a project of an organization nurturing never saw created
    When its usage changes
    Then no group call is sent and the sync counts not_placed

  @unit
  Scenario: A dry run of the resync sends nothing and saves no checkpoint
    Given organizations with plans and members
    When the resync runs as a dry run
    Then no fact is recorded and no Customer.io call is sent
    And the report counts organizations, members, the most group calls and identifies it could send, and skips by reason

  @unit
  Scenario: Running the resync task without --execute sends nothing
    Given organizations with plans and members
    When a person runs pnpm task customer-io-plan-resync without --execute
    Then only the dry run runs, so no fact is recorded and no Customer.io call is sent
    And the dry run totals are printed

  @unit
  Scenario: Running the resync task with --execute prints the dry run totals, then sends
    Given organizations with plans and members
    When a person runs pnpm task customer-io-plan-resync --execute
    Then a dry run over every organization runs first and its totals are printed
    And then each organization with members has its plan and members recorded
    And the recorded totals are printed

  @integration
  Scenario: A resync run records each organization's plan and members once and a second run sends the same values
    Given organizations with plans and members
    When the resync runs twice
    Then both runs record the same plan and member list per organization
    And the Customer.io attributes after the second run equal those after the first

  @integration
  Scenario: A refused organization retries on its own
    Given Customer.io refuses one organization's calls
    When the resync's facts are delivered
    Then that fact is retried
    And no other organization's delivery is affected

  @unit
  Scenario: The plan copy keeps the newest fact, and a real fact wins a tie
    Given nurturing's plan copy holds a real subscription_changed fact for an organization
    When an older catch-up fact, a catch-up with the same stamp and a newer catch-up are folded in turn
    Then the older fact and the tied catch-up leave the copy unchanged, so they send nothing
    And the newer catch-up replaces it

  @unit
  Scenario: The plan fold sends only the fact that won it
    Given billing's facts for an organization delivered live, a newer one after an older one
    When each is folded into nurturing's plan copy
    Then each fact that wins the copy sends once, and a fact that loses it mints no send
    And the winning fact delivered again sends nothing more, as its send is claimed

  @unit
  Scenario: A refused plan send retries its own job
    Given the plan fold committed a winning fact, and Customer.io refuses its send
    When the send's job is retried
    Then the retry sends the plan
    But a retry after a newer fact won the copy sends nothing

  @unit
  Scenario: The deploy replay fills the plan copy as live delivery would, and sends nothing
    Given billing's log holds subscription facts from before the plan fold existed
    When the nurturing:replay-organization-plans step runs, and runs again
    Then the plan copy equals the copy live delivery of the same facts builds, its winner included
    And no Customer.io or PostHog call is made, though the winning fact would send live
    And a newer live fact afterwards sends exactly once

  @integration
  Scenario: The plan fold's row keeps the ids it folded and the fact that won
    Given the plan fold stored an organization's plan, won by one subscription fact
    When a delivery of an older fact stores the fold's state again
    Then the row still holds the winning fact and its event id
    And it holds the ids of that latest delivery, so a redelivery of it folds nothing

  @unit
  Scenario: A catch-up fact with no Customer.io channel fails visibly
    Given the deployment names no Customer.io key
    When a resync catch-up fact is delivered
    Then delivery fails with no_customer_io_channel
    And the fact stays in the queue to be replayed

  @unit
  Scenario: A resync skips organizations with no members and stops on abort
    Given an organization with no active members and an abort signal after the first page
    When the resync runs
    Then the empty organization is counted as skipped
    And the run stops between organizations
    And a re-run starts from the start

  @unit
  Scenario: A person whose paid team is their latest join is never told free by the resync
    Given the member copy is empty and a person joined their own free organization, then a paid one
    When organization's member_listed facts are copied and then both organizations' catch-up facts are delivered in either order
    Then the person is identified once, with the paid plan
    And the free organization's fact sends only its company call

  @unit
  Scenario: A catch-up fact identifies no member without a member-copy row, a live one still does
    Given an organization with two members, one with a member-copy row and one without
    When the resync's catch-up fact for it is delivered
    Then only the member with a row is identified
    And the group call still carries the plan to the organization's admin
    And the skipped member is counted and logged
    And a live fact for the same organization identifies both members

  @unit
  Scenario: No request carries more than a hundred members
    Given an organization with 250 active members
    When its plan is delivered
    Then the identifies go out in requests of at most 100

  @unit
  Scenario: PostHog's subscription_started is unchanged
    Given a subscription became active on a paid plan
    When its signals are delivered
    Then PostHog receives subscription_started with the plan for every member as before

  # --- AC Coverage Map ---
  # AC 1: "started subscription: plan on members and company"          -> Scenario: A started subscription tells Customer.io the plan on members and company
  #        -> Scenario: A member current in another organization is not told this plan
  # AC 2: "paid-to-paid shows new plan, never free"                    -> Scenario: A paid-to-paid change shows the new plan and never free (evidence: two linked tests)
  # AC 3: "last cancel returns to free; remaining sub keeps plan; pending is not paid" (evidence: two linked tests)
  #        -> Scenario: Cancelling the last active subscription returns the organization to free
  #        -> Scenario: Cancelling one of two subscriptions keeps the other's plan
  #        -> Scenario: A pending checkout does not make the plan paid
  # AC 4: "renewal or seat change sends nothing"                       -> Scenario: A renewal or a seat change tells Customer.io nothing
  # AC 5: "stored fact without plan sends no plan"                     -> Scenario: A subscription_changed fact stored before it carried a plan sends no plan
  # AC 6: "createAndAssign organization gets name and created_at, no plan" -> Scenario: A new organization gets its name and creation time on its founder
  # AC 7: "provisioned organization without founder sends nothing"     -> Scenario: A provisioned organization with no founder sends nothing
  # AC 8: "sign-up path unchanged"                                     -> Scenario: The sign-up path keeps its calls
  # AC 9: "usage sync adds project_count and created_at; omit unknown; not placed sends nothing"
  #        -> Scenario: The usage sync adds the company traits to its group call only
  #        -> Scenario: Company traits nurturing does not know are left out
  #        -> Scenario: An organization nurturing never placed still sends nothing
  # AC 10: "dry run sends nothing, saves no checkpoint, reports counts" -> Scenario: A dry run of the resync sends nothing and saves no checkpoint
  #        -> Scenario: Running the resync task without --execute sends nothing
  #        -> Scenario: Running the resync task with --execute prints the dry run totals, then sends
  # AC 11: "real run records once; a second run sends the same values"  -> Scenario: A resync run records each organization's plan and members once and a second run sends the same values (evidence: two linked tests)
  # AC 12: "refused organization retries, others unaffected"            -> Scenario: A refused organization retries on its own
  #        -> Scenario: The plan copy keeps the newest fact, and a real fact wins a tie
  # AC 13: "no channel does not finish as done"                         -> Scenario: A catch-up fact with no Customer.io channel fails visibly
  # AC 14: "no-member skip; abort stops; no resume (amended: hand-run task, a re-run starts from the start)" -> Scenario: A resync skips organizations with no members and stops on abort
  # AC 15: "at most 100 members per request"                            -> Scenario: No request carries more than a hundred members
  # AC 16: "PostHog subscription_started unchanged"                     -> Scenario: PostHog's subscription_started is unchanged
  # AC 17: "no running campaign or segment filters on plan before deploy" -> before-merge checklist item, not a scenario (process proof, like AC 18)
  # AC 18: "rollback: re-run with corrected code; dry-run report kept"  -> PR-description proof, not a scenario (no behaviour to automate)

Feature: A license that reached its end date still binds the numbers it sold

  A self-hosted deployment runs uncapped without a license, so dropping an
  expired one back to that baseline hands the customer more than a current
  license gives them: the seat cap disappears and the deployment reports itself
  as unlicensed. Letting a license lapse ends up worth more than renewing it,
  which is backwards.

  A license LangWatch genuinely signed stays a record of what was bought after
  its end date. What expires is the right to a new term, not the fact of the
  purchase, so the numbers in the signed payload keep binding: seats stay at the
  count that was paid for, and the capabilities the plan names stay switched on.
  The signature, not the date, is what decides whether a license counts.

  Nothing about access changes on the day a license lapses. Nobody is signed
  out, no membership is disabled, and everyone who had a seat keeps working,
  exactly as they do when an organization activates a license for fewer seats
  than it already has. Renewal buys back one thing: room to grow. Adding a
  member is refused while a lapsed license has its seats full, which is the same
  refusal an over-seats organization already gets.

  A license we did not sign is a different thing. Its numbers cannot be trusted
  at all, so a tampered or unreadable one still resolves to the open-source
  baseline, exactly like no license.

  Cloud is deliberately left alone. There a license is an override sitting on
  top of a Stripe subscription, so a lapsed one has to step aside and let the
  subscription underneath take over.

  As a self-hosted customer whose license reached its end date
  I want my deployment to keep working exactly as it did the day before
  So that renewing is about buying more, never about restoring what I had

  Background:
    Given a self-hosted deployment
    And an organization "org-123" exists

  @integration
  Scenario: A lapsed license keeps metering the seats it sold
    Given the organization holds a license for 5 members that reached its end date
    When the active plan is resolved
    Then the plan allows 5 members
    And the plan is not the open-source baseline

  @integration
  Scenario: A lapsed license keeps the capabilities it bought
    Given the organization holds an Enterprise license that reached its end date
    When the active plan is resolved
    Then the plan is still identified as Enterprise
    And the enterprise-only surfaces stay available

  @integration
  Scenario: Nobody loses their seat on the day a license lapses
    Given the organization holds a license for 5 members that reached its end date
    And the organization has more active members than the license covers
    When the active plan is resolved
    Then every member is still active
    And none of them was disabled by the lapse

  @unit
  Scenario: Adding a member is refused once a lapsed license is full
    Given a plan resolved from a license for 5 members that reached its end date
    And the organization already holds 5 full members
    When an admin tries to add another full member
    Then the request is refused for exceeding the licensed seats

  @integration
  Scenario: A license we did not sign is still not a license
    Given the organization holds a license whose payload was edited after signing
    When the active plan is resolved
    Then the plan is the open-source baseline

  @integration
  Scenario: A deployment that never had a license stays uncapped
    Given the organization has no license stored
    When the active plan is resolved
    Then the plan is the open-source baseline

  @integration
  Scenario: On Cloud a lapsed license steps aside for the subscription
    Given a Cloud organization whose license reached its end date
    When the shared license override is resolved
    Then it reports the open-source baseline
    And that baseline is flagged free so the subscription underneath applies

  @integration
  Scenario: The license page says what the lapse changed and what it did not
    Given the organization holds a license that reached its end date
    When an admin opens the license page
    Then the license is shown as expired
    And they are told the seats and capabilities stay as they are
    And they are told they cannot add members until they renew

  @integration
  Scenario: An organization over the seats of a lapsed license is asked to reconcile
    Given the organization holds a license for 5 members that reached its end date
    And the organization has more active members than the license covers
    When an admin opens the license page
    Then the organization is shown as over its seat count

  @integration
  Scenario: A license we did not sign is not called expired
    Given the organization holds a license whose payload was edited after signing
    And the payload claims an end date in the past
    When an admin opens the license page
    Then the license is shown as invalid rather than expired
    And no seat warning is shown

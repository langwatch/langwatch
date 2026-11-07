Feature: Ops seat sharing check
  A removed member's seat can be reused after 30 days, so an organization could rotate one
  paid seat among many people. Once a day Ops checks every organization on a paid plan: the
  distinct people active in the last 30 days (a rolling window, not a calendar month) beside
  its paid full seats, the plan's maxMembers. An organization is flagged when its active
  people go over twice its seats. Only Cloud admin sees the check, on its seat use page under
  /ops/cloud (ARCHITECTURE.md §3.5); customers never do.

  "Held a seat in the window" means a full-seat member today, or a member removed or disabled
  in the last 30 days (read from the organization's member_removed and member_disabled facts;
  a fact that says the person held no full seat is skipped, an older fact without it counts;
  authz offboarding and account erasure report the seat type the same way).
  "Active" means the person signed in (User.lastLoginAt) or used a browser session
  (Session.updatedAt, rolled once a day while used, or Session.lastSeenAt) in the window.

  @unit
  Scenario: An organization with more than twice its seats in active people is flagged
    Given ACME is on a paid plan with 5 full seats
    And 12 people held a seat in the last 30 days and were active in them
    When the seat sharing check runs
    Then ACME reads 12 active people on 5 seats and is flagged

  @unit
  Scenario: Exactly twice its seats is not flagged
    Given an organization on a paid plan with 3 full seats and 6 active people in the window
    When the seat sharing check runs
    Then the organization is not flagged

  @unit
  Scenario: People removed or disabled in the window count beside today's full-seat members
    Given an organization with 2 full-seat members today
    And 3 more people were removed or disabled in the last 30 days
    And one person was removed 40 days ago
    When the seat sharing check runs
    Then the 5 people who held a seat in the window are counted, each once
    And the person removed 40 days ago is not

  @unit
  Scenario: Only people who signed in or used a session in the window count
    Given 4 people held a seat in the window
    And one signed in, one used a browser session, one did both, and one did neither
    When the seat sharing check runs
    Then 3 active people are counted

  @unit
  Scenario: Free organizations are not checked
    Given an organization on the free plan
    When the seat sharing check runs
    Then the check holds no reading for it

  @unit
  Scenario: A paid plan with uncapped seats is not checked
    Given a paid organization whose plan sells uncapped seats (the UNLIMITED sentinel)
    When the seat sharing check runs
    Then the check holds no reading for it

  @unit
  Scenario: An organization the check cannot read is skipped and the rest are kept
    Given two organizations on paid plans
    And reading the plan of one of them fails
    When the seat sharing check runs
    Then the check holds a reading for the other one
    And the failure is logged with the organization id

  @unit
  Scenario: The check runs once a day and its first wake runs at once
    Given the seat sharing schedule wakes hourly, the first time an hour after the worker starts
    When it wakes for the first time
    Then it asks for a check at once
    And it asks again only once a day has passed since the last check

  @unit
  Scenario: A failed check waits for the next day and the outbox is still pruned
    Given the seat sharing check throws
    When the daily tick runs
    Then the failure is logged and the tick finishes
    And dispatched check rows older than 7 days are pruned

  @unit
  Scenario: A deployment without Cloud admin neither runs nor serves the check
    Given ops's cloud-ops capability is off
    When the daily check wakes
    Then nothing is read and nothing is kept
    And reading the check is refused with not_found

  @unit
  Scenario: Reading the check before it ever ran answers none
    Given Cloud admin is on and no check has run yet
    When Ops reads the seat sharing check
    Then it answers an empty list

  @integration
  Scenario: Today's full-seat members are the people holding a full seat now
    Given an organization with an admin, a member, a lite member, a disabled member and a deactivated person
    When organization lists who held a seat since a moment
    Then the admin and the member are the full-seat members
    And the disabled member is listed as departed since it was disabled

  @unit
  Scenario: A departure records whether the person held a full seat
    Given an organization with an admin and an external member
    When the admin removes the external member
    Then the member_removed fact records that the person held no full seat

  @integration
  Scenario: Only departures that held a full seat count, older facts count as before
    Given three people left an organization in the last 30 days
    And one fact says the person held a full seat, one says they held none, one says nothing
    When organization lists who held a seat in the window
    Then the person who held a full seat and the person whose fact says nothing are departed
    And the person who held no full seat is not

  @integration
  Scenario: Offboarding records whether the person held a full seat
    Given an organization with a member and an external member with a view-only custom role
    When authz offboards each of them
    Then the member's offboarding reports a full seat and the external member's reports none

  @integration
  Scenario: Erasure records the organizations where the person held a full seat
    Given a person who is a member of one organization and an external member of another
    When their account is erased
    Then the erased fact names both organizations and only the first as a full seat

  @unit
  Scenario: Offboarded and erased departures carry the seat type from the fact
    Given an authz offboarding fact and a user erased fact for the same organization
    When organization records the departures
    Then each departure carries the seat type the fact reported
    And a fact from before the seat type was recorded carries none, so it still counts

  @integration
  Scenario: A session used or a sign-in in the window marks a person active
    Given one person whose browser session was used yesterday and one whose session was last used 40 days ago
    And one person who signed in yesterday and one who last signed in 40 days ago
    When auth and user are asked who was active in the last 30 days among them
    Then only the session used yesterday and the sign-in yesterday answer

  @integration
  Scenario: Ops sees people on seats beside each organization
    Given Cloud admin is on and the last check read ACME as 12 active people on 5 seats
    When staff open the Cloud admin seat use page at /ops/cloud/seat-use
    Then ACME's row reads "12 people on 5 seats" with a "Seat sharing 2.4x" warning chip
    And an organization under twice its seats reads its people and seats with no chip
    And a free organization's row reads "Not checked"

  @integration
  Scenario: The Over 2x seats filter narrows the list to flagged organizations
    Given the last check flagged ACME only
    When staff switch on the "Over 2x seats" filter
    Then the list asks for ACME's id only

  @integration
  Scenario: The organization list narrows to the flagged organizations' ids
    Given three organizations in Postgres
    When Ops lists organizations filtered to two of their ids
    Then only those two are listed, with a total of two
    And a search still narrows within them

  @integration
  Scenario: Before the first check the list says it has not run yet
    Given Cloud admin is on and no check has run yet
    When staff open the Cloud admin seat use page
    Then the page says the seat sharing check has not run yet
    And the "Over 2x seats" filter is disabled

  @integration
  Scenario: A failed read of the check shows an error and the list still loads
    Given reading the seat sharing check fails
    When staff open the Cloud admin seat use page
    Then the page says the seat sharing check could not be loaded
    And the organizations are still listed

  @integration
  Scenario: A self-hosted Ops has no seat use page
    Given ops's cloud-ops capability is off
    When an operator opens /ops/cloud/seat-use
    Then it answers as an unknown page
    And the check is never asked for

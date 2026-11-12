Feature: The most seats an organization held at once in a month

  A seat frees the moment its holder leaves, so one seat can be passed round many people.
  Our team needs to see, at renewal, the most full and Lite Member seats an organization held
  at once in each calendar month, not only how many it holds today. A pending invitation and a
  seat held for 30 days after somebody leaves both count, as they do for the cap. The decision is ADR-002 (../adrs/002-seat-peak-from-seat-transitions.md).

  Background:
    Given an organization whose seats were counted when seat counting started

  Rule: the peak is the most seats held at once, however briefly

    @unit
    Scenario: Passing one seat round several people raises the month's peak
      Given the organization holds 10 full seats
      When an admin adds a full member and then removes another, three times over
      Then the organization holds 10 full seats
      And the month's full seat peak is 11

    @unit
    Scenario: A pending invitation counts toward the peak
      Given the organization holds 10 full seats
      When an admin invites somebody to a full seat
      Then the month's full seat peak is 11

    @unit
    Scenario: Accepting an invitation does not count its seat twice
      Given the organization holds 10 full seats and a pending invitation to a full seat
      When the invitation is accepted
      Then the month's full seat peak is 11

    @unit
    Scenario: An expired invitation gives its seat back from the moment it expired
      Given the organization holds 10 full seats and a pending invitation to a full seat
      And the invitation expired yesterday
      When an admin adds a full member today
      Then the month's full seat peak is 11

    @unit
    Scenario: Extending an invitation keeps its seat until the new expiry
      Given the organization holds 10 full seats and a pending invitation to a full seat
      And the invitation was due to expire yesterday
      And an admin extended it before it expired
      When an admin adds a full member today
      Then the month's full seat peak is 12

    @unit
    Scenario: Full and Lite Member seats peak separately
      Given the organization holds 10 full seats and 4 Lite Member seats
      When a Lite Member is given a full seat
      Then the month's full seat peak is 11
      And the month's Lite Member seat peak is 4

    @unit
    Scenario: Developer seats are not counted toward either peak
      Given the organization holds 10 full seats
      When a developer joins
      Then the month's full seat peak is 10
      And the month's Lite Member seat peak is 0

    @unit
    Scenario: Making a member an admin raises no peak
      Given the organization holds 10 full seats
      When an admin makes a member an admin
      Then the month's full seat peak is 10

  Rule: a held seat counts until its hold ends, as it does for the cap

    @unit
    Scenario: A removed member's held seat keeps counting toward the peak
      Given the organization holds 10 full seats
      When an admin removes a full member, whose seat is held for 30 days
      And an admin adds a full member
      Then the organization holds 11 full seats
      And the month's full seat peak is 11

    @unit
    Scenario: A held seat is given back from the moment its hold ends
      Given the organization holds 9 full seats and a seat held until yesterday
      When an admin adds a full member today
      Then the month's full seat peak is 10

    @unit
    Scenario: A person back within their hold takes their held seat, not a second one
      Given the organization holds 9 full seats and a seat held for a removed person
      When the person is admitted again
      Then the organization holds 10 full seats
      And the month's full seat peak is 10

    @unit
    Scenario: A full invitation to a held person's address takes the hold's place
      Given a seat held for a removed person
      When an admin invites the same address to a full seat
      Then the hold no longer counts toward the full seats
      And it counts again once the invitation is revoked

    @unit
    Scenario: The opening count includes the seats held for people who left
      Given an organization with 2 full members and a seat held for a removed person
      When counting opens
      Then the opening count holds 3 full seats

  Rule: every way a seat is taken or given back is counted

    @integration
    Scenario Outline: A seat taken on any path is counted
      Given the organization holds 10 full seats
      When somebody takes a full seat by <path>
      Then the month's full seat peak is 11

      Examples:
        | path                                         |
        | joining through single sign-on               |
        | joining by their email domain                |
        | being invited                                |
        | an approved join request                     |
        | a payment-pending invitation being approved  |
        | being created by the directory               |
        | being re-enabled after being disabled        |
        | being moved from a Lite Member to full       |

    @integration
    Scenario: A Lite Member given a custom role that edits takes a full seat
      Given the organization holds 10 full seats and a Lite Member with a view-only custom role
      When the Lite Member is given a custom role that can edit
      Then the month's full seat peak is 11

    @integration
    Scenario Outline: A seat given back on any path lowers the running count
      Given the organization holds 10 full seats
      When a full member's seat is given back by <path>
      And an admin adds a full member
      Then the month's full seat peak is 10

      Examples:
        | path                                   |
        | being removed                          |
        | being disabled                         |
        | being moved to a Lite Member           |
        | their invitation being revoked         |
        | their whole account being deactivated  |

    @integration
    Scenario: A new organization starts counting from its first admin
      When somebody creates an organization
      Then the month's full seat peak is 1

  Rule: a month carries the count it began with

    @unit
    Scenario: A month nobody joined or left peaks at the count it began with
      Given the organization held 12 full seats at the end of October
      And nobody joined or left in November
      Then November's full seat peak is 12

    @unit
    Scenario: A month's peak is never below the count it began with
      Given the organization held 12 full seats at the end of October
      When a full member is removed on 3 November
      Then November's full seat peak is 12

  Rule: the count can be rebuilt and is never doubled

    @unit
    Scenario: A seat change delivered twice is counted once
      Given the organization holds 10 full seats
      When the same seat change is delivered twice
      Then the month's full seat peak is 11

    @unit
    Scenario: Rebuilding the count from the recorded changes gives the same peaks
      Given an organization's seat changes over three months
      When the count is rebuilt from those changes
      Then every month's peaks are the same as before

  Rule: counting opens once for every organization that existed before it

    @unit
    Scenario: The opening snapshot step opens every organization not yet counted, a page at a time
      Given three organizations, one of them counted already
      When the opening snapshot step runs
      Then the two not yet counted are opened
      And the step saves where it got to after each page

    @unit
    Scenario: The opening snapshot step resumes after the last page it saved
      Given the opening snapshot step saved its place after the second organization
      When the step runs again
      Then only the organizations after the second are opened

    @unit
    Scenario: A dry run of the opening snapshot step opens nothing and saves no checkpoint
      When the opening snapshot step runs as a dry run
      Then no organization is opened
      And no checkpoint is saved

  Rule: our team sees the peak at renewal; the customer does not

    @integration
    Scenario: The ops console shows this month's peak beside the licence's seats
      Given the organization's licence covers 50 full seats
      And the organization held 57 full seats at once this month
      When somebody on our team opens the organization on the ops console
      Then they see 57 as this month's full seat peak beside the 50 the licence covers
      And they see when the peak was reached
      And they see the peak of each earlier month

    @integration
    Scenario: The ops console reads an unlimited licence's seats as unlimited
      Given the organization's licence covers unlimited full seats
      When somebody on our team opens the organization on the ops console
      Then they see the full seats in use beside "unlimited", not a number

    @integration
    Scenario: The ops console says how many seat changes disagreed with the count
      Given seat changes for the organization named a seat its count did not hold
      When somebody on our team opens the organization on the ops console
      Then they see how many seat changes disagreed with the count

    @integration
    Scenario: The ops console says when counting has not started for an organization
      Given an organization whose seats have not been counted yet
      When somebody on our team opens the organization on the ops console
      Then they see that seat counting has not started, not a peak of zero

    @integration
    Scenario: The customer's own pages do not show the peak
      Given the organization held more seats at once this month than it holds now
      When an admin of the organization opens its members page
      Then they see the seats in use and not the month's peak

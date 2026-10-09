Feature: The insights inbox
  Langy writes short findings about a project into an inbox. A member reads
  them, marks them done or keeps them. An insight is shared by the project;
  what one member has seen, archived or kept belongs to that member alone.

  Background:
    Given the release_insights flag is on for the project

  Rule: Filing an insight

    @integration
    Scenario: A member saves a Langy answer as an insight
      Given a member with analytics:manage on the project
      When they save a Langy answer as an insight with a title, a body and a tone
      Then the insight is filed against the project
      And it records the Langy conversation and message it came from
      And it shows at the top of their inbox

    @unit
    Scenario: The member who files an insight has already seen it
      Given a member files an insight
      When they read their inbox
      Then that insight does not count as unseen for them
      And it counts as unseen for every other member

    @integration
    Scenario: A viewer cannot file an insight
      Given a member with analytics:view but not analytics:manage
      When they try to file an insight
      Then the request is refused before the handler runs

    @unit
    Scenario: An insight without a title is refused
      Given a file request with an empty title
      When the request is validated
      Then it is refused with a field error on the title

  Rule: Folders are derived per reader, at read time

    @unit
    Scenario: A fresh insight is in the inbox
      Given an insight filed 2 days ago that stays true for 7 days
      When the reader opens Insights
      Then it is in the Inbox folder

    @unit
    Scenario: An insight past its validity is stale
      Given an insight filed 8 days ago that stays true for 7 days
      When the reader opens Insights
      Then it is in the Stale folder

    @unit
    Scenario: A kept insight stays in the inbox after its validity ends
      Given an insight filed 8 days ago that stays true for 7 days
      And the reader kept it
      When the reader opens Insights
      Then it is in the Inbox folder

    @unit
    Scenario: A done insight is archived
      Given an insight the reader marked done
      When the reader opens Insights
      Then it is in the Archived folder

    @unit
    Scenario: Keeping an archived insight brings it back to the inbox
      Given an insight the reader marked done
      When the reader keeps it
      Then it is in the Inbox folder

    @unit
    Scenario: The badge counts unseen insights in the inbox only
      Given 3 unseen insights in the inbox and 1 unseen stale insight
      When the badge is derived
      Then the count is 3

  Rule: Reader state is personal

    @unit
    Scenario: One member marking an insight done does not move it for another
      Given two members of the project and one insight
      When the first member marks it done
      Then it is archived for the first member
      And it is still in the inbox for the second member

    @unit
    Scenario: Opening a folder marks what it shows as seen, once
      Given 2 unseen insights in the inbox
      When the reader opens the Inbox folder
      Then both are marked seen
      And a second visit sends no new seen event

  Rule: Refusals

    @integration
    Scenario: Insights are refused when the flag is off
      Given the release_insights flag is off for the project
      When a member asks for the project's insights
      Then the request is refused with insights_not_enabled

    @integration
    Scenario: Acting on an unknown insight is refused
      Given no insight with the id in the project
      When a member marks it done
      Then the request is refused with insight_not_found

    @integration
    Scenario: An insight from another project is not found
      Given an insight filed in another project
      When a member of this project keeps it
      Then the request is refused with insight_not_found

    @integration
    Scenario: A member without analytics:view cannot read insights
      Given a member without analytics:view on the project
      When they ask for the project's insights
      Then the request is refused before the handler runs

  Rule: The inbox page

    @e2e
    Scenario: A project with no insights shows how to get the first one
      Given a project with no insights
      When a member opens Insights
      Then they see "Langy writes your brief here"
      And an action that opens Langy

    @e2e
    Scenario: The bell lists new insights
      Given 5 unseen insights in the inbox
      When a member opens the bell in the top bar
      Then it shows the 4 newest
      And a link that opens the inbox

    @integration
    Scenario: An archived insight offers Restore
      Given an insight the reader marked done
      When the reader opens the Archived folder and chooses Restore
      Then the insight is kept for that reader
      And it is back in their Inbox folder

  Rule: The line under the title

    @unit
    Scenario: An insight seen again today says so
      Given an insight a later run found still true today
      When the line under its title is written
      Then it reads "Seen again today · still true through" and the day its validity ends

    @unit
    Scenario: An insight seen again on an earlier day names that day
      Given an insight a later run found still true 2 days ago
      When the line under its title is written
      Then it reads "Seen again" with that day, then "still true through" and the day its validity ends

    @unit
    Scenario: A kept insight says it was kept as still relevant
      Given an insight the reader kept
      When the line under its title is written
      Then it reads "Kept as still relevant"

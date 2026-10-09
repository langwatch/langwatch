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

  Rule: Where an insight came from
    An insight may point at the board and the widget it came from. It is only a pointer:
    nothing checks that either exists, and the insight reads the same once either is deleted.

    @unit
    Scenario: An insight filed from a board keeps a pointer to the board and the widget
      Given a member saves a Langy answer that was about a widget on a board
      When the insight is filed
      Then it keeps the ids and the names of the board and the widget as they were
      And every reader of the project reads the same pointer

    @unit
    Scenario: A member's filing is recorded as saved from a chat
      Given a member files an insight
      When a reader reads their inbox
      Then the insight is recorded as filed from a chat, not by a run

    @unit
    Scenario: An insight filed before pointers existed still reads
      Given a filed event stored without a board, a kind or a window
      When the event is folded
      Then the insight has no pointer and no window
      And it is recorded as filed from a chat

    @unit
    Scenario: An insight stored before pointers existed still reads
      Given an insight row written before the pointer and window columns existed
      When the row is read
      Then the insight has no pointer and no window
      And it is recorded as filed from a chat

    @unit
    Scenario: The pointer is stored as plain ids and names
      Given an insight that came from a widget on a board
      When its row is written
      Then the row holds the board's id and name and the widget's id and name
      And reading the row back gives the same pointer

    @integration
    Scenario: Saving a Langy answer about a board passes the pointer and the window
      Given a Langy answer that names the board, the widget, the query and the window it read
      When a member saves it as an insight
      Then the filing carries that board and widget, that query and that window
      And an answer that names none of them is filed with none

  Rule: Evidence on fixed dates
    An insight keeps what to run, never the result: its query, the fixed window the query
    read and the values in force when it was filed.

    @unit
    Scenario: An insight keeps its query, the fixed window and the values it was filed with
      Given a member files an insight with a query, a window and parameter values
      When a reader reads their inbox
      Then the insight carries that query, that window and those values unchanged

    @unit
    Scenario: A window without a query is refused
      Given a file request with a window and no query
      When the request is validated
      Then it is refused with a field error on the window

    @unit
    Scenario: A window that ends before it starts is refused
      Given a file request whose window ends before it starts
      When the request is validated
      Then it is refused with a field error on the window's end

    @unit
    Scenario: The window is stored beside the values in force
      Given an insight with a query, a window and parameter values
      When its row is written
      Then the row holds the start, the end and the step as columns and the values as one JSON map
      And reading the row back gives the same window and values

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

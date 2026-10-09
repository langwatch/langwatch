Feature: The insights inbox
  Langy writes short findings about a project for one person. An insight has one owner,
  the person whose Langy made it. Only the owner reads it, marks it done or keeps it; to
  everyone else it does not exist. Copying its text is how an owner shares it.

  Background:
    Given the release_insights flag is on for the project

  Rule: Filing an insight

    @integration
    Scenario: A member saves a Langy answer as an insight
      Given a member with analytics:view on the project
      When they save a Langy answer as an insight with a title, a body and a tone
      Then the insight is filed in the project, with them as its owner
      And it records the Langy conversation and message it came from
      And it shows at the top of their inbox

    @integration
    Scenario: Saving a Langy answer says only the saver sees the insight
      Given a member with analytics:view and no more
      When they save a Langy answer as an insight
      Then they are told it is saved and that only they see it

    @unit
    Scenario: The member who files an insight has already seen it
      Given a member files an insight
      When they read their inbox
      Then that insight does not count as unseen for them

    @integration
    Scenario: A member without analytics:view cannot file an insight
      Given a member without analytics:view on the project
      When they try to file an insight
      Then the request is refused before the handler runs

    @unit
    Scenario: An insight without a title is refused
      Given a file request with an empty title
      When the request is validated
      Then it is refused with a field error on the title

  Rule: An insight belongs to one person
    The owner is the person whose Langy made the insight: whoever saved the answer, or the
    person a run filed it for. Every read and every act is the owner's alone, and another
    member's insight answers exactly as an id no insight has.

    @unit
    Scenario: An insight a run files for a person belongs to that person
      Given a run files an insight for a member, with no person who saved it
      When the project's members read their inboxes
      Then the member it was filed for reads it, unseen
      And no other member's inbox holds it

    @unit
    Scenario: An insight filed before owners existed belongs to whoever filed it
      Given a filed event stored without an owner
      When the event is folded
      Then the person who filed it owns the insight

    @integration
    Scenario: An insight stored before owners existed belongs to whoever filed it
      Given an insight row written before the owner column existed
      When the person who filed it and another member read their inboxes
      Then the person who filed it reads it
      And the other member's inbox does not hold it

    @integration
    Scenario: Another member's inbox does not hold the insight
      Given a member filed an insight with a query and a window
      When another member of the project asks for their insights
      Then the answer holds no insight, so no title, no query and no window
      And their unseen count is 0

    @integration
    Scenario: Another member's insight answers as an unknown one
      Given a member filed an insight
      When another member of the project marks it done, then keeps it
      Then each request is refused with insight_not_found
      And each refusal matches the refusal for an id no insight has
      And the insight has not moved for its owner

    @integration
    Scenario: Marking another member's insight seen records nothing
      Given a member filed an insight
      When another member of the project marks it seen
      Then the request answers as it does for an id no insight has
      And no seen event is recorded for them

    @integration
    Scenario: An owner who lost analytics:view reads nothing
      Given a member filed an insight and then lost analytics:view on the project
      When they ask for their insights, or act on the one they filed
      Then each request is refused before the handler runs

    @integration
    Scenario: A single insight is read by its owner alone
      Given a member owns an insight
      When the owner and another member each read it by its id
      Then the owner reads it with their own seen, done and kept state
      And the other member is refused as for an id no insight has

    @integration
    Scenario: A read's limit counts the owner's insights only
      Given two members who each filed insights in the project
      When one of them reads their inbox with a limit of 2
      Then they read their own 2 newest, whatever the other filed since

  Rule: Where an insight came from
    An insight may point at the board and the widget it came from. It is only a pointer:
    nothing checks that either exists, and the insight reads the same once either is deleted.

    @unit
    Scenario: An insight filed from a board keeps a pointer to the board and the widget
      Given a member saves a Langy answer that was about a widget on a board
      When the insight is filed
      Then it keeps the ids and the names of the board and the widget as they were
      And its owner reads that pointer in their inbox

    @unit
    Scenario: A member's filing is recorded as saved from a chat
      Given a member files an insight
      When they read their inbox
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
    Scenario: The row shows the board and the widget an insight came from
      Given an insight that came from a widget on a board
      When a member reads the row
      Then under the title the row hands the board and the widget, ids and names, to the dashboards trail
      And where nothing draws the trail the names read as they were filed

    @integration
    Scenario: The row links to the board and the widget while they exist
      Given an insight that came from a widget on a board
      And the board and the widget still exist
      When a member reads the row
      Then the board's name and the widget's name each link to the board

    @integration
    Scenario: A deleted board leaves plain names on the row
      Given an insight that came from a widget on a board
      And the board was deleted
      When a member reads the row
      Then the board reads as its name as filed with "(deleted)" and has no link
      And the widget's name as filed has no link

    @integration
    Scenario: A deleted widget leaves its name on the row
      Given an insight that came from a widget on a board
      And the widget was removed from the board
      When a member reads the row
      Then the board's name still links to the board
      And the widget reads as its name as filed with "(deleted)" and has no link

    @integration
    Scenario: A reader without Dashboards reads the names without links
      Given an insight that came from a widget on a board
      And Dashboards is not open to the reader
      When the reader reads the row
      Then the board and the widget read as their names as filed, with no link
      And neither is called deleted

    @integration
    Scenario: The row says how the insight was filed
      Given an insight a member saved from a Langy answer
      When a member reads the row
      Then under the title it reads "Saved from a chat with Langy"
      And an insight filed by a run reads "Daily run"

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
      When they read their inbox
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

    @integration
    Scenario: The card replays the query over the window it was filed with
      Given an insight with a query and a window from Jul 5 to Aug 3
      When a member opens the card
      Then the query runs through the query door as that member, for that window, with the values it was filed with
      And the values are bound beside the query, never written into its text

    @integration
    Scenario: The card says which dates and values the evidence was replayed with
      Given an insight from a board with a query, a window from Jul 5 to Aug 3 and the period "Last 30 days"
      When a member opens the card
      Then under the chart it reads "Replayed with: Jul 5 to Aug 3 · Last 30 days. The board as it was set when Langy filed this."

    @integration
    Scenario: A reader the query is refused for sees the refusal, not the numbers
      Given an insight whose query the reader may not run
      When the card replays the query
      Then the card shows the refusal the query door gave
      And no chart is drawn

    @integration
    Scenario: An insight with no window draws no evidence
      Given an insight filed with a query and no window
      When a member opens the card
      Then no chart is drawn and nothing is replayed

    @unit
    Scenario: The line under the chart names the dates and every value in force
      Given a window from Jul 5 to Aug 3 with the period "Last 30 days" and a model parameter
      When the line under the chart is written
      Then it names the first and the last day, the period and the parameter with its value

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

  Rule: Seen is marked once

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
      When a member asks for their insights
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
      When they ask for their insights
      Then the request is refused before the handler runs

  Rule: The inbox page

    @e2e
    Scenario: A project with no insights shows how to get the first one
      Given a project with no insights
      When a member opens Insights
      Then they see "Langy writes your brief here"
      And that the brief is theirs alone
      And an action that opens Langy

    @e2e
    Scenario: The bell lists new insights
      Given 5 unseen insights in the inbox
      When a member opens the bell in the top bar
      Then it shows the 4 newest
      And a link that opens the inbox

    @integration
    Scenario: The page says only you see your insights
      Given a member opens Insights
      When the page draws
      Then it reads "Only you see your insights."

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

  Rule: Copying an insight
    Copy puts a plain-text version on the clipboard, to paste into Slack or an email. It is
    the only way an insight leaves its owner.

    @unit
    Scenario: The copied text carries the title, the body, the fixed period and the board
      Given an insight from a widget on a board, with a window from Jul 5 to Aug 3 2026, the period "Last 30 days" and a model parameter
      When its plain text is written
      Then it reads the title, then the body with its numbers as Langy wrote them and its headers as plain lines
      And a line with the first and the last day, the year, the period and the parameter with its value
      And a line with the board and the widget as they were filed

    @unit
    Scenario: The copied text of an insight with no board and no window is its title and body
      Given an insight filed with no board and no window
      When its plain text is written
      Then it reads the title and the body, and names no period and no board

    @integration
    Scenario: Copy puts the insight on the clipboard and says so
      Given an insight in the inbox
      When the reader chooses Copy
      Then its plain text is written to the clipboard
      And they read "Copied. Paste it anywhere."

    @integration
    Scenario: A clipboard that refuses says the copy failed
      Given a browser that refuses the clipboard
      When the reader chooses Copy
      Then they are told the insight could not be copied

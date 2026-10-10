Feature: The daily insights run
  A run starts a Langy turn for one person about one board. Langy reads the board's widgets
  with that person's permissions as they are when the run starts, and hands back findings.
  The insight module checks the findings and files each one in that person's inbox, unread.
  Langy only reads: filing is the one write, and the insight module does it. Every run
  records an outcome: filed, nothing, failed or skipped.

  Background:
    Given the release_insights flag is on for the project

  Rule: A run acts as the person, as they are when it runs

    @unit
    Scenario: A run files what Langy found, for the person it ran for
      Given a member with analytics:view and a board with widgets
      When a run is requested for them on that board and Langy answers two findings
      Then two insights are filed as a run, with them as owner and no person who saved them
      And both are unseen in their inbox
      And each records the run's conversation and the answer's message
      And each points at the board, and the run's row reads filed with a count of 2

    @unit
    Scenario: A member without analytics:view gets no run and Langy is never called
      Given a member without analytics:view on the project
      When a run is requested for them
      Then the run is recorded as skipped with the reason no_access
      And Langy is never called and no insight is filed

    @unit
    Scenario: A member removed after the run was requested gets no run
      Given a run that filed insights for a member
      And the member was then removed from the project
      When another run is requested for them
      Then the run is recorded as skipped with the reason no_access
      And Langy was not called again and nothing new was filed

    @unit
    Scenario: A person who no longer exists gets no run
      Given a user id no user has
      When a run is requested for it
      Then the run is recorded as skipped with the reason user_missing
      And Langy is never called

    @unit
    Scenario: A deactivated person gets no run
      Given a member whose account was deactivated
      When a run is requested for them
      Then the run is recorded as skipped with the reason no_access
      And Langy is never called

    @unit
    Scenario: Langy refusing the person skips the run
      Given a member Langy is not released to, and a member Langy finds nothing to read with
      When a run is requested for each
      Then the first run is recorded as skipped with the reason langy_off
      And the second as skipped with the reason no_access
      And no insight is filed

    @unit
    Scenario: A run for one person changes nothing another person reads
      Given a run that filed insights for a member
      When another member of the project reads their inbox and their runs
      Then their inbox holds no insight
      And they read no run

  Rule: With the flag off nothing runs

    @unit
    Scenario: A run cannot be requested while the flag is off
      Given the release_insights flag is off for the project
      When a run is requested
      Then the request is refused with insights_not_enabled
      And no run event is recorded

    @unit
    Scenario: A run that starts after the flag went off is skipped
      Given the release_insights flag is off for the project
      When a run already requested is carried out
      Then it is skipped with the reason flag_off
      And Langy is never called

    @unit
    Scenario: A project that takes no run is skipped
      Given a project that is archived, an aggregate or gone
      When a run is carried out in it
      Then it is skipped with the reason project_unavailable
      And Langy is never called

  Rule: The board is a pointer to a stored board or a From LangWatch board

    @unit
    Scenario: A board that was deleted skips the run
      Given a run requested on a board that was then deleted
      When the run is carried out
      Then it is recorded as skipped with the reason board_deleted
      And Langy is never called

    @unit
    Scenario: A board that cannot be read in the project skips the run
      Given a project where dashboards or custom charts are off
      When a run is requested on a board
      Then it is recorded as skipped with the reason board_unreadable
      And Langy is never called

    @unit
    Scenario: A board with no widgets skips the run
      Given a board with no widgets
      When a run is requested on it
      Then it is recorded as skipped with the reason board_empty
      And Langy is never called

    @unit
    Scenario: A From LangWatch board is skipped with its own reason
      Given a run requested on a From LangWatch board, named by its template id
      When the run is carried out
      Then it is recorded as skipped with the reason template_board
      And the run's row names the template board
      And Langy is never called

    @unit
    Scenario: The board is read as the person the run is for
      Given a run requested for a member on a board
      When the run reads the board and its widgets
      Then each read names that member as the viewer

    @unit
    Scenario: A board pointer names a stored board or a template, and nothing else
      Given a board pointer with the kind dashboard, the kind template and an unknown kind
      When each is validated
      Then the first two are accepted
      And the unknown kind is refused

  Rule: Langy's answer is untrusted

    @unit
    Scenario: An answer with no findings files nothing
      Given Langy answers an empty list of findings
      When the run is carried out
      Then no insight is filed
      And the run is recorded as nothing

    @unit
    Scenario: An answer without the agreed block fails the run
      Given Langy answers prose with no findings block
      When the run is carried out
      Then no insight is filed
      And the run is recorded as failed with the reason bad_output

    @unit
    Scenario: One finding over the limits fails the whole answer
      Given an answer with one good finding and one whose title is 300 characters long
      When the answer is checked
      Then the answer is refused whole
      And no finding is taken from it

    @unit
    Scenario: A bad answer files nothing
      Given Langy answers one good finding and one whose title is 300 characters long
      When the run is carried out
      Then no insight is filed
      And the run is recorded as failed with the reason bad_output

    @unit
    Scenario: More findings than the maximum are cut to the maximum
      Given Langy answers 7 findings and the run's maximum is 3
      When the run is carried out
      Then exactly the first 3 are filed
      And the run's row reads filed with a count of 3

    @unit
    Scenario: A widget that is not on the board is dropped from the finding
      Given a finding that names a widget on the board and one that names a widget elsewhere
      When the run files them
      Then the first points at the widget, with the name the board gives it
      And the second points at the board alone

    @unit
    Scenario: An answer cannot choose the owner, the project or the board
      Given an answer whose finding also names an owner, a project and a board
      When the answer is checked
      Then the answer is refused whole

    @unit
    Scenario: An answer that hands back the brief's own example is refused
      Given an answer that repeats the example finding the brief shows
      When the answer is checked
      Then the answer is refused whole

    @unit
    Scenario: Two findings blocks in one answer are refused
      Given an answer that holds two findings blocks
      When the answer is checked
      Then the answer is refused whole

    @unit
    Scenario: A findings block that is not valid JSON is refused
      Given an answer whose findings block is cut off
      When the answer is checked
      Then the answer is refused whole

    @unit
    Scenario: A finding with a query is filed with the run's own window
      Given a finding that carries a query
      When the run files it
      Then the insight replays that query over the window the run was given
      And a finding without a query is filed with no window

  Rule: The run always records an outcome

    @unit
    Scenario: A failed turn records a failed run
      Given Langy's turn fails
      When the run is carried out
      Then the run is recorded as failed with the reason turn_failed
      And the run's row names the conversation

    @unit
    Scenario: A turn that asks a question is stopped and recorded as failed
      Given Langy asks the person a question
      When the run is carried out
      Then the turn is stopped
      And the run is recorded as failed with the reason needs_input

    @unit
    Scenario: A turn that does not finish in time is stopped and recorded as failed
      Given Langy's turn outlasts the run's deadline
      When the run is carried out
      Then the turn is stopped
      And the run is recorded as failed with the reason timeout

    @unit
    Scenario: A run that cannot start is retried, then recorded on the last attempt
      Given Langy cannot start the turn
      When the run is carried out on an attempt that is not the last
      Then the failure is thrown for the retry and no outcome is recorded
      And on the last attempt the run is recorded as failed

  Rule: Delivery is at least once

    @unit
    Scenario: A run carried out twice files once
      Given a run that filed two insights
      When the same run is carried out again
      Then the person's inbox holds the same two insights and no more
      And each insight was filed once and the run settled once

    @unit
    Scenario: A request delivered twice starts one run
      Given a run request the schedule already took
      When the same request is delivered again
      Then no second run is started

    @unit
    Scenario: A second request while a run is in flight starts nothing
      Given a run in flight for a board
      When another run is requested for the same person and board
      Then no second run is started
      And once the first run settles a new request starts a run

    @unit
    Scenario: A run that never settled does not block the board for good
      Given a run that started longer ago than a run may take
      When another run is requested for the same person and board
      Then the new run is started

    @unit
    Scenario: A settled run keeps its first outcome
      Given a run recorded as filed
      When the same run is settled again as failed
      Then the run's row still reads filed

  Rule: The brief Langy is given

    @unit
    Scenario: The brief is the same for the same run
      Given one run's board, dates, maximum and open insights
      When the brief is written twice
      Then both are the same text

    @unit
    Scenario: The brief names the board, its widgets, the fixed dates and the maximum
      Given a board with two widgets and a run with a maximum of 3
      When the brief is written
      Then it names the board and each widget by id and name
      And the fixed window and the window before it, in epoch milliseconds
      And the maximum of 3, and that Langy must not ask or write

    @unit
    Scenario: Names written by customers are cleaned before they reach the brief
      Given a board and a widget whose names hold line breaks and backticks
      When the brief is written
      Then each name is on one line with no backtick

    @unit
    Scenario: The brief lists the person's open insights for the board
      Given the person has an open insight, a done insight and an insight from another board
      When the brief is written
      Then it lists the open insight of this board and neither of the others

    @unit
    Scenario: The run reads the last full day before it started
      Given a run that started at 09:37 on a day
      When its dates are fixed
      Then the window is the whole day before, and the window before it the day before that

  Rule: The run's row

    @unit
    Scenario: A run before any other leaves a row for the person and the board
      Given a run requested for a member on a board
      When the run settles
      Then the member reads one run, for that board, with its last outcome and when it ran

    @integration
    Scenario: The run's row is stored per person and board in the project
      Given runs settled for two people on the same board, and one in another project
      When each person's runs are read in the project
      Then each reads their own row and no other

    @unit
    Scenario: The operator task requests one run for a project, a person and a board
      Given an operator names a project, a person and a board
      When the task runs
      Then one run is requested for that person on that board
      And a task run without a project, a person or a board is refused

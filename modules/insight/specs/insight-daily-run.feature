Feature: The daily insights run
  A run starts a Langy turn for one person about one board. Langy reads the board's widgets
  with that person's permissions as they are when the run starts, and hands back findings.
  The insight module checks the findings and files each one in that person's inbox, unread.
  Langy only reads: filing is the one write, and the insight module does it. Every run
  records an outcome: filed, nothing, failed or skipped. A person turns the run on for a
  board, and it then starts once per calendar date, around the hour they chose, in their zone.

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
    Scenario: Langy refusing a deactivated person skips the run
      Given a member Langy finds deactivated when the turn is asked for
      When a run is requested for them
      Then the run is recorded as skipped with the reason no_access
      And no insight is filed

    @unit
    Scenario: A member who lost access during the turn files nothing
      Given a run whose turn Langy is reading for a member
      And the member loses analytics:view before Langy answers
      When Langy answers two findings
      Then no insight is filed
      And the run is recorded as skipped with the reason no_access, naming the conversation

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
      When the run reads the board and its widgets, before the turn and again before it files
      Then each read names that member as the viewer, and the widgets are asked by board

    @unit
    Scenario: Another member's Only me board reads as a board that is not there
      Given a board its author keeps as Only me
      When a run is requested on it for another member, and one on a board that never existed
      Then both are recorded as skipped with the reason board_deleted, and read alike
      And neither run's row names what the board holds
      And Langy is never called

    # The run's own reads pass for the author. Langy's command line reads over REST with the
    # run's key, which the author owns, so the door reads the board as the author (ADR-004).
    @unit
    Scenario: The author's run reads their own Only me board
      Given a board its author keeps as Only me
      When a run is requested on it for the author and Langy answers two findings
      Then the brief lists the board's widgets
      And two insights are filed for the author

    @unit
    Scenario: A board that turned Only me after the request skips another member's run
      Given a run requested for a member on a board another member authored
      And the author then set the board to Only me
      When the run is carried out
      Then it is recorded as skipped with the reason board_deleted
      And Langy is never called

    @unit
    Scenario: An Organization board is read from another project of its organization
      Given an Organization board another project owns
      When a run is requested on it in a project of the same organization, and in one of another
      Then the first run's brief lists the board's own widgets
      And the second is recorded as skipped with the reason board_deleted

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
    Scenario: A finding longer than a run may file fails the whole answer
      Given an answer with one good finding and one whose title is 121 characters or whose body is 4,001
      When the answer is checked
      Then the answer is refused whole

    @unit
    Scenario: A finding that holds a web address is refused by name
      Given an answer whose finding holds an http, an https or a www address in its title, body or topic
      When the answer is checked
      Then the answer is refused whole with the reason finding_has_url

    @unit
    Scenario: An answer with a web address files nothing
      Given Langy answers one good finding and one whose body holds a link
      When the run is carried out
      Then no insight is filed
      And the run is recorded as failed with the reason finding_has_url

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
      Given a finding that hands back a stored query of the widget it names
      When the run files it
      Then the insight replays that query over the window the run was given
      And a finding without a query is filed with no window

    # The query an insight keeps is the board's own text, never Langy's: a query Langy wrote
    # may name a database or a date, and then the insight does not replay elsewhere or later.
    @unit
    Scenario: A finding keeps only a stored query of the widget it names
      Given a widget on the board that stores a query on several lines
      When an answer's findings name the widget and hand that query back, as stored and on one line
      Then each finding keeps the query exactly as the board stores it

    @unit
    Scenario: A stored query handed back with the run's step written in is kept as stored
      Given a widget on the board whose stored query declares the step parameter
      When a finding names the widget and hands the query back with the run's step in its place
      Then the finding keeps the query exactly as the board stores it, parameter included

    @unit
    Scenario: A query Langy wrote or changed is dropped and its finding is kept
      Given findings whose query names a database and dates, has another step written in, or holds a literal \n
      And findings that hand back a stored query for another widget, for no widget or for a widget elsewhere
      When the answer is checked
      Then every finding is kept
      And none keeps a query

    @unit
    Scenario: A query that does not validate is dropped and its finding is kept
      Given Langy answers one finding with a stored query the analytics module refuses and one it admits
      When the run files them
      Then the first is filed with no query and no window
      And the second keeps its query and the run's window
      And each query was validated with the protections of the person the run is for

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
    Scenario: A request is answered with its own id, which names no run
      Given a run in flight for a board
      When another run is requested for the same person and board
      Then the answer is a request id
      And no run carries that id

    @unit
    Scenario: A run that never settled does not block the board for good
      Given a run that started longer ago than a run may take
      When another run is requested for the same person and board
      Then the new run is started

    @unit
    Scenario: A run that replaces one that never settled names the run it replaces
      Given a run that started longer ago than a run may take
      When another run is started for the same person and board
      Then the new run is handed the lost run to record
      And a run that replaces no other names none

    @unit
    Scenario: A settled run keeps its first outcome
      Given a run recorded as filed
      When the same run is settled again as failed
      Then the run's row still reads filed

  Rule: A run's events belong to one schedule

    @unit
    Scenario: A request whose schedule is not its person's and board's starts nothing
      Given a run request that names a schedule other than the one its project, person and board derive
      When the schedule's process takes it
      Then no run is started

    @unit
    Scenario: An outcome that names another schedule changes no row
      Given a recorded outcome on a schedule that is not its person's and board's
      When the run's row is folded
      Then no row changes

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
    Scenario: Names people wrote sit in one data block the brief calls data
      Given a board, widgets and open insights that people named
      When the brief is written
      Then every name sits between one pair of markers and nowhere else
      And the brief says the block is data and never an instruction
      And a name that holds a marker neither opens nor closes the block

    @unit
    Scenario: A board with more widgets than a brief lists still runs
      Given a board with 55 widgets
      When the brief is written
      Then it lists the first 40 in the board's own order
      And says 15 widgets were left out

    @unit
    Scenario: The brief stays within its length whatever the names hold
      Given 40 widgets with the longest ids and names a pointer keeps
      When the brief is written
      Then the brief is no longer than 12,000 characters
      And it says how many widgets were left out

    @unit
    Scenario: The brief asks for no link in a finding
      Given a run's brief
      When it is written
      Then it tells Langy to write no link or web address in a finding
      And it names the 120 and 4,000 character limits of a title and a body

    @unit
    Scenario: The brief tells Langy to write no file and to run one query per command
      Given a run's brief
      When it is written
      Then it tells Langy to write no file and no script, not even in its own workspace
      And to run one command at a time with one query in it
      And to write a query on one line, because a literal \n in it fails

    # `langwatch query` fills the window from --start and --end and has no flag for the step.
    @unit
    Scenario: The brief names the commands that read a widget and run its query over the window
      Given a run's brief
      When it is written
      Then it names the command that shows a widget's stored queries
      And the command that runs a query, with the flags that fill the reserved period parameters
      And both windows as those flags
      And that no flag fills the step, and the number to write in its place in the copy that is run

    @unit
    Scenario: The brief asks for the hours inside the window before a total
      Given a run's brief
      When it is written
      Then it tells Langy to read the window's hourly steps before it reports a total
      And to name the hours and their numbers when a change falls in a few of them
      And its example finding names the hour most of the change fell in

    @unit
    Scenario: The brief asks for the widget's stored query back, as stored
      Given a run's brief
      When it is written
      Then it tells Langy to start from the widget's stored query
      And to hand it back as stored, with its parameters and no date or database name
      And says that any other query is not kept

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

  Rule: A person turns their own daily run on, changes it and turns it off

    @integration
    Scenario: A member turns their daily run on, reads it back, changes the hour and turns it off
      Given a member with analytics:view and a board they can open
      When they read the board's daily run, turn it on, change the hour and turn it off
      Then they read undecided, then on with the hour, zone and maximum they chose
      And then the new hour, and then off with what they last chose

    @integration
    Scenario: A daily run keeps the stored board's own name, not the name that was sent
      Given a stored board named Costs
      When a member turns its daily run on and sends another name for it
      Then the run's row names the board Costs

    @integration
    Scenario: No thanks from the offer stores off
      Given a board a member never decided on
      When they say no thanks to the offer
      Then they read off with nothing chosen
      And they can still turn it on

    @integration
    Scenario: A From LangWatch board can be turned on
      Given a From LangWatch board, named by its template id
      When a member turns its daily run on
      Then they read on, and no stored board is read
      And a stored board with the same id is still undecided

    @integration
    Scenario: A setting a schedule does not take is refused
      Given an hour outside 0 to 23, a time zone that is no IANA zone name, or a maximum that is not 1, 3, 5 or 10
      When a member sends it as their daily run's setting
      Then it is refused before the module is asked
      And nothing is recorded

    @integration
    Scenario: A member reads and writes only their own daily run setting
      Given a member turned their daily run on for a board
      When another member of the project reads the same board, and turns their own on and off
      Then the other member reads their own setting and never the first member's
      And the first member's setting is unchanged

    @integration
    Scenario: Another member's Only me board cannot be turned on, and answers as a board that is not there
      Given a board its author keeps as Only me
      When another member turns its daily run on, and one for a board that never existed
      Then both are refused alike with dashboard_not_found, never as forbidden
      And nothing is recorded for them, and the author can turn theirs on

    @integration
    Scenario: A daily run setting is refused while the flag is off
      Given the release_insights flag is off for the project
      When a member reads, turns on or turns off a board's daily run
      Then each is refused with insights_not_enabled
      And nothing is recorded and no board is read

    @integration
    Scenario: An aggregate project takes no daily run setting
      Given an organisation admin on an aggregate project
      When they turn a board's daily run on or off
      Then each is refused as read only before the module is asked
      And a read there answers undecided

    @integration
    Scenario: A member without analytics:view cannot read or set a daily run
      Given a member without analytics:view on the project
      When they read, turn on or turn off a board's daily run
      Then each is refused as forbidden before the handler runs

    @integration
    Scenario: A daily run setting is stored per person and board in the project
      Given two people set the same board, one on and one off
      When each setting is read by its person's own schedule
      Then each reads their own
      And neither is read through the other's schedule, from another project or by an unknown id

    @unit
    Scenario: A setting and a run's outcome fold onto one row
      Given a person turned their daily run on
      When a run of it settles, they change it and they turn it off
      Then the row holds what they chose beside how the last run ended, through each

    @unit
    Scenario: A setting whose schedule is not its person's and board's changes nothing
      Given a setting or an off that names a schedule other than the one its project, person and board derive
      When the schedule's process and its row take it
      Then nothing is turned on or off, and no row changes

  Rule: A daily run that is on runs once per calendar date, around its hour, in its own zone

    @unit
    Scenario: A schedule runs at its own minute, the same every day and spread across schedules
      Given 600 schedules
      When each one's minute of the hour is derived from its id
      Then one schedule's minute is the same every time
      And the schedules use every minute of the hour, with none crowded

    @unit
    Scenario: Turning the daily run on arms the next slot and starts no run
      Given a person turns their daily run on for an hour
      When that hour is still ahead today, or has passed
      Then the slot armed is today's, or tomorrow's
      And no run is started

    @unit
    Scenario: A daily run that is on wakes, runs, settles and arms the next day
      Given a member turned their daily run on for a board
      When the slot comes due and its run is carried out
      Then one run starts for the member on that board, and files what Langy found
      And the member reads the run's outcome beside their setting
      And the next day's slot is armed

    @unit
    Scenario: A wake starts one run for its slot, on the path a request takes
      Given a schedule that is on and its slot is due
      When the wake is handled
      Then the outbox is handed the same intent a request writes, for the person, the board and the slot
      And the run is named by its slot

    @unit
    Scenario: A second wake for the same calendar date starts no second run
      Given a schedule whose slot already ran today
      When another wake comes for the same date
      Then no run is started
      And the next day's slot is armed

    @unit
    Scenario: A schedule that already ran for a date waits for the next date
      Given a schedule whose last run was for today
      When its next slot is derived, with its hour still ahead today
      Then the slot is tomorrow's

    @unit
    Scenario: A schedule runs once on each day the clocks change
      Given a schedule for 09:00 in a zone whose clocks go forward on one day and back on another
      When its slots are derived across each of those days
      Then each calendar date has one slot, at 09 on the wall clock

    @unit
    Scenario: An hour the clocks skip runs at the next valid time that day
      Given a schedule for 02:00 in a zone whose clocks go from 02:00 to 03:00 that day
      When its slot for that day is derived
      Then the slot is at 03 on the wall clock that day, at the schedule's own minute
      And the day after it is at 02 again

    @unit
    Scenario: An hour the clocks repeat runs once
      Given a schedule for 02:00 in a zone whose clocks go from 03:00 back to 02:00 that day
      When its slots are derived
      Then the slot is the first of the two, and the next is the day after
      And a wake for the second is refused once the first ran

    @unit
    Scenario: An hour changed before today's run runs today at the new hour
      Given a schedule that has not run today
      When the person changes its hour to one still ahead today
      Then today's slot at the new hour is armed, and no run is started

    @unit
    Scenario: An hour changed after today's run waits for the next day
      Given a schedule whose run already happened today
      When the person changes its hour to one still ahead today
      Then tomorrow's slot at the new hour is armed, and no run is started

    @unit
    Scenario: An hour changed to one that has passed starts no run and waits for the next day
      Given a schedule that has not run today
      When the person changes its hour to one that has passed today
      Then tomorrow's slot is armed, and no run is started

    @unit
    Scenario: A slot missed by less than six hours still runs
      Given a schedule whose slot came due while the fleet was down
      When the wake is handled 5 hours 59 minutes late
      Then the slot's run is started once, and the next day's slot is armed

    @unit
    Scenario: A slot missed by six hours or more waits for the next day
      Given a schedule whose slot came due while the fleet was down
      When the wake is handled 6 hours 1 minute late
      Then no run is started
      And the next day's slot is armed

    @unit
    Scenario: A wake while a run is in flight starts no second run
      Given a run in flight for a board whose schedule is on
      When the schedule's slot comes due
      Then no second run is started, and the run in flight stands for the slot
      And the next day's slot is armed

    @unit
    Scenario: A run that never settled is superseded by the next day's wake
      Given a scheduled run that recorded no outcome
      When the next day's slot comes due
      Then the next day's run is started
      And it is handed the lost run to record

    @unit
    Scenario: A superseded run is recorded as failed with the reason timeout
      Given a run that replaces one that never settled
      When the run is carried out, once or twice
      Then the lost run is recorded once as failed with the reason timeout, before the new run's outcome
      And the person reads the new run's outcome

    @unit
    Scenario: An operator's run leaves the schedule's wake armed
      Given a schedule that is on
      When an operator's run is requested and settles before the slot
      Then the slot stays armed for today

    @unit
    Scenario: A process instance written before the schedule still reads
      Given a schedule's process instance stored before a schedule could be turned on
      When it is read, and a wake reaches it
      Then it reads as a schedule nobody turned on, and no run is started

  Rule: Off, and a board that is gone, stop the schedule

    @unit
    Scenario: Turning the daily run off cancels its wake
      Given a member turned their daily run on for a board
      When they turn it off before the slot
      Then no wake is armed and no run starts at the slot
      And they read off, with what they chose kept

    @unit
    Scenario: A daily run turned off and on again the same day does not run twice
      Given a schedule whose run already happened today
      When the person turns it off and on again for a later hour today
      Then tomorrow's slot is armed

    @unit
    Scenario: A run that finds its board gone turns the daily run off
      Given a member turned their daily run on for a board that was then deleted
      When the slot's run is carried out
      Then it is recorded as skipped with the reason board_deleted
      And the member reads off, and no wake is armed

    @unit
    Scenario: A board that is gone turns off no daily run the person never turned on
      Given a board a person never decided on, or said no thanks to
      When a run finds the board gone
      Then their setting stays as it was

    @unit
    Scenario: A From LangWatch board that is on is skipped each day and stays on
      Given a member turned their daily run on for a From LangWatch board
      When the slot's run is carried out
      Then it is recorded as skipped with the reason template_board
      And the member reads on, and the next day's slot is armed

  Rule: A reconcile pass arms a schedule that lost its wake

    @unit
    Scenario: The reconcile pass runs hourly, once across the fleet
      Given the daily run pipeline as the worker registers it
      When the pass's process is read
      Then it is a scheduled singleton that wakes every hour
      And each wake hands the outbox one pass, keyed by the wake

    @integration
    Scenario: A reconcile pass reads every project's schedules that are on
      Given schedules that are on in two projects, beside ones that are off or undecided
      When a pass reads them, a page at a time
      Then it reads each one that is on once, in its own project, and no other

    @unit
    Scenario: A schedule that is on with no process instance is armed by the pass
      Given a schedule whose row is on and whose process holds no instance
      When a pass runs
      Then its process is asked to arm itself with the row's setting
      And it takes the setting and arms its next slot, with no run started

    @unit
    Scenario: A schedule whose wake was lost is armed again with its own setting
      Given a schedule that is on and whose wake was lost
      When a pass runs
      Then its next slot is armed again, never on a date that already ran
      And its setting is unchanged

    @unit
    Scenario: A pass leaves an armed schedule alone
      Given a schedule that is on with its wake armed
      When a pass runs
      Then nothing is asked of it

    @unit
    Scenario: A pass turns on no schedule the person turned off
      Given a schedule the person turned off, whose row is a fold behind and still reads on
      When a pass runs, or its request to arm arrives after the off
      Then the schedule stays off

    @unit
    Scenario: A pass carried out twice asks each schedule once
      Given a pass the outbox delivers twice
      When each delivery asks a schedule to arm itself
      Then both name the same pass
      And one request is recorded

  Rule: A board's header carries the person's daily insights control

    @integration
    Scenario: A board's header draws the action a peer lends it
      Given a stored board with widgets and a From LangWatch board
      When a module lends an action to the board header
      Then the stored board hands it the kind dashboard, its id, its name and its widget count
      And the From LangWatch board hands it the kind template and its template id
      And a header nobody lends to draws nothing more

    @integration
    Scenario: A board a member never answered offers daily insights
      Given a board with widgets and a member who never answered for it
      When they open the board
      Then a dialog asks whether to turn on daily insights for that board
      And the quiet control is in the header

    @integration
    Scenario: A board with no widgets offers nothing
      Given a board with no widgets and a member who never answered for it
      When they open the board
      Then no offer opens and the header holds no daily insights control

    @integration
    Scenario: Closing the offer decides nothing
      Given the offer is open on a board
      When the member closes it without an answer
      Then nothing is sent to the server
      And the offer stays closed for this visit, with the quiet control in the header

    @integration
    Scenario: No thanks on the offer sends an off for the board
      Given the offer is open on a board
      When the member says no thanks
      Then an off is sent for that board
      And the offer closes and the quiet control stays

    @integration
    Scenario: Turning on from the offer sends the hour, the zone and the maximum
      Given the offer is open on a board
      When the member turns it on as offered, or after choosing another hour and maximum
      Then the run is set for hour 9, the browser's time zone and at most 3 insights
      And a changed hour and maximum are sent as chosen

    @unit
    Scenario: A daily run takes any hour, a time zone and one of four maximums
      Given the daily run's choices
      When they are listed
      Then every hour from 00:00 to 23:00 can be chosen, and the maximums 1, 3, 5 and 10
      And a board starts at 09:00, the reader's own time zone and at most 3
      And the reader's zone is listed first, with a zone the run already has kept on the list

    @unit
    Scenario: A run time is said as around its hour
      Given a run set for 9 in Europe/Amsterdam
      When its time is put in words
      Then it reads around 09:00 Amsterdam time, never at 09:00

    @unit
    Scenario: A board offers once per visit and never after an answer
      Given a board that opened with widgets, without widgets, or while its widgets load
      When the person is undecided, said no, or turned it on, and has or has not closed the offer
      Then the offer shows only to an undecided person on a board that opened with a widget
      And not again in a visit where they closed it

    @integration
    Scenario: A board that is off shows the quiet control and no offer
      Given a member said no thanks to a board, or turned it off
      When they open the board
      Then no offer opens
      And turning it on from the control sends what they last chose, or the defaults

    @integration
    Scenario: A board that is on shows one dropdown
      Given a member turned a board's daily run on
      When they open the dropdown in the board's header
      Then it says when the run reads the board, around its hour, and what the last run did
      And Open Insights leads to their inbox
      And Settings opens the run's choices, and saving sends them
      And the switch in the dropdown sends an off

    @integration
    Scenario: The control counts the board's unseen insights
      Given a board that is on, with 2 unseen insights from it and 1 from another board
      When the member looks at the board's header
      Then the control says 2 new

    @integration
    Scenario: A board that is on with no widgets waits
      Given a board that is on and lost its last widget
      When the member opens the dropdown
      Then the control says it waits, and the dropdown says there is nothing to read

    @integration
    Scenario: The dropdown says how the last run ended
      Given a board that is on
      When its last run filed 2, found nothing new, failed, or was skipped for each reason a run records
      Then the dropdown names the outcome in plain words, and no run yet before the first one
      And a skipped run says it did not run and why

    @integration
    Scenario: A From LangWatch board takes the control and is named by its template id
      Given a From LangWatch board
      When a member turns its daily run on
      Then the setting is sent with the kind template and the template's id
      And after a run it says calmly that Langy cannot read From LangWatch boards yet

    @integration
    Scenario: A From LangWatch board says before the answer that no run reads it yet
      Given a From LangWatch board a member never answered for
      When the offer opens
      Then it says Langy cannot read From LangWatch boards yet and a run files nothing for now
      And the offer on a stored board says no such thing

    @integration
    Scenario: The control is absent without the flag, the grant or a project that takes runs
      Given the release_insights flag is off, or a member without analytics:view, or an aggregate project
      When a board's header is drawn
      Then no daily insights control shows, no offer opens and nothing is asked of the server

    @integration
    Scenario: The control changes before the server answers
      Given a board that is off
      When the member turns it on and the server has not answered yet
      Then the header already shows the dropdown of a board that is on

    @integration
    Scenario: A refused write puts the control back and says so
      Given a board that is off, and a server that refuses the write
      When the member turns it on
      Then the control goes back to off
      And the member is told it could not be turned on

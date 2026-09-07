Feature: The panel says what the page is doing while Langy drives it
  As someone watching Langy work on the page I have open,
  I want the panel to name what is happening on that page as it happens,
  So that a long step reads as work in progress rather than as a stall.

  # The status line may only say things that are true when it says them, so
  # with no tool running and no tokens arriving it falls back to a whimsical
  # verb that claims nothing ("Cooking…"). That was the honest answer to a
  # question nobody could answer: the panel knew what the TURN was doing and
  # nothing about what the PAGE was doing.
  #
  # While Langy drives the workbench the page holds the better truth. It is
  # applying an action, or streaming a run's cells back one by one, and it
  # knows which column and how far along. Reported, that becomes the most
  # specific true line available, and the stretch that read as a stall becomes
  # the stretch with the most to show.

  Rule: What the page reports is what the line says

    @unit
    Scenario: A run streaming into the page names the column and the progress
      Given the open page is running a column Langy started
      When rows come back
      Then the status line names that column and how many rows are done
      And no whimsical verb is shown while it runs

    @unit
    Scenario: An action being applied says which one
      Given the open page is applying an action Langy called
      Then the status line names that action in plain words

    @unit
    Scenario: A page with nothing to report leaves the line to the turn
      Given the open page reports no activity
      Then the line is whatever the turn's own signals say

  Rule: The page outranks what the turn can infer

    # The agent waits for a run by polling, so the tool actually running is a
    # status command. Naming that tells the reader about the agent's
    # bookkeeping; naming the run tells them about their own work.
    @unit
    Scenario: Page activity wins over the command the agent is blocked on
      Given the agent is blocked on a status poll
      And the open page is streaming a run
      Then the status line names the run rather than the poll

    @unit
    Scenario: Page activity survives the turn falling quiet between steps
      Given tool calls on this turn have already settled
      And the open page is streaming a run
      Then the status line names the run rather than thinking

  Rule: The line stops when the work does

    @unit
    Scenario: A finished run releases the line
      Given the open page has finished the run it was streaming
      Then the status line no longer names it

    @integration
    Scenario: Leaving the workbench clears what it was reporting
      Given the workbench reported activity to the panel
      When the page unmounts
      Then the panel reports nothing from it

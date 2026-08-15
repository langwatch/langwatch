Feature: A screen fetches a drawer's code before the person opens it

  Every drawer is a separate download, fetched the first time something opens
  it. Until it arrives the page can show only a spinner where the drawer will
  be, so a click on a table row looks like it did nothing for as long as the
  download takes.

  A screen knows which drawer its rows open. It fetches that code while the
  person is still reading the list, and the click then opens the drawer with
  no download in the way.

  Rule: A screen warms the drawers it opens

    @integration
    Scenario: The scenario library warms the scenario editor
      Given the scenario library is on screen
      When the browser becomes idle
      Then the scenario editor's code is fetched

    # Fetching the code is not the whole of it. A drawer keeps its own record of
    # whether it is ready, so a drawer whose code is in memory still reports
    # itself as not ready on the first render and shows the spinner for a
    # moment. The warm-up settles that record as well.
    @integration
    Scenario: A warmed drawer opens with no spinner in between
      Given a drawer whose code is already fetched
      When it is opened
      Then it renders at once

    # The data the person waits for comes first. A warm-up that starts with the
    # screen's own queries competes with them and makes the visible wait longer.
    @unit
    Scenario: The warm-up waits for the browser to be idle
      Given a screen that warms a drawer
      When the screen renders
      Then no code is fetched yet

    @unit
    Scenario: Leaving the screen cancels a warm-up that has not started
      Given a screen that warms a drawer
      When the screen closes before the browser is idle
      Then no code is fetched

  # A warm-up downloads a file the same way an open does, so after a deploy it
  # can ask for a file name that no longer exists. The recovery for that is a
  # page reload, which is correct for a person waiting on a drawer and wrong
  # for a person reading a list who asked for nothing.
  Rule: A failed warm-up does not take the page away

    @unit
    Scenario: A stale file during a warm-up does not reload the page
      Given a warm-up is in flight
      When the download fails because the file is gone
      Then the page is not reloaded

    # The drawer must not remember the failed warm-up either: a drawer that
    # records itself as failed keeps that answer for the life of the page, so
    # one lost download would leave a drawer that can never open.
    @integration
    Scenario: A drawer whose warm-up failed can still be opened
      Given a warm-up that could not fetch the code
      When the drawer is opened later
      Then the code is fetched again and the drawer opens

    @unit
    Scenario: A stale file outside a warm-up still reloads the page
      Given no warm-up is in flight
      When a download fails because the file is gone
      Then the page reloads once

    # A warm-up runs in the background, so a person can open a drawer while one
    # is still going. Standing down for the whole of a warm-up would take the
    # recovery away from that open as well, so the page tells the two apart and
    # stands down only for the warm-up's own download.
    @unit
    Scenario: A stale file for a waiting screen reloads during a warm-up
      Given a warm-up is in flight
      When another download fails because the file is gone
      Then the page reloads once

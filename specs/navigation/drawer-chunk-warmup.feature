Feature: A screen fetches a drawer's code before the person opens it

  Every drawer is a separate download, fetched the first time something opens
  it. Until it arrives the page can show only a spinner where the drawer will
  be, so a click on a table row looks like it did nothing for as long as the
  download takes.

  A screen knows which drawer its rows open. It fetches that code while the
  person is still reading the list, and the click then opens the drawer with
  no download in the way.

  Rule: A screen warms the drawers it opens

    # The two screen-level warm-ups ("The scenario library warms the scenario
    # editor", "The runs page warms the drawers its rows and sidebar open") were
    # retired on 2026-09-05: dev/docs/plans/restore-or-retire-2026-09-05.md marks
    # them "retire — use-preload-drawer is a documented no-op".

    # Fetching the code is not the whole of it. A drawer keeps its own record of
    # whether it is ready, so a drawer whose code is in memory still reports
    # itself as not ready on the first render and shows the spinner for a
    # moment. The warm-up settles that record as well.
    @integration
    Scenario: A warmed drawer opens with no spinner in between
      Given a drawer whose code is already fetched
      When it is opened
      Then it renders at once

    # A drawer that is not ready yet says so by handing back something that
    # finishes later. The warm-up has to wait for that, and it has to wait
    # whatever shape the drawer's answer arrives in — a warm-up that decides it
    # is finished while the code is still downloading has warmed nothing, and
    # the drawer shows its spinner exactly as it did before.
    @unit
    Scenario: A warm-up finishes only once the drawer's code is ready
      Given a drawer whose code is still downloading
      When the drawer is warmed
      Then the warm-up is unfinished while the code is still on its way
      And it finishes once the code has arrived
      And it finishes rather than failing if the code never arrives

    @unit
    Scenario: A warm-up for a drawer with nothing to fetch finishes at once
      Given a drawer with no separate code to download
      When the drawer is warmed
      Then the warm-up finishes without waiting

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

    # A person can open a drawer while a warm-up runs; the page stands down only for the
    # warm-up's own download. What a waiting screen does is in chunk-load-retry.feature.
    @unit
    Scenario: A stale file outside a warm-up still reloads the page
      Given no warm-up is in flight
      When a download fails because the file is gone
      And the server confirms the file is gone
      Then the page reloads once

@unit
Feature: haven up terminal viewer — scroll and search

  The attached `haven up` viewer (cmd/upviewer.go) streams every lane's
  output live. Before this, the only way to read anything that scrolled
  off screen was to leave the viewer and grep a log file by hand. Every
  log tab now scrolls and searches in place, without breaking the
  existing tab-switching, dashboard, or stop/quit bindings.

  Background:
    Given the up viewer is open on a log tab with captured output

  Scenario: Scrolling back leaves following mode
    When the developer scrolls up with PgUp, an arrow key, "k", the mouse
      wheel, or Home
    Then the view stops tracking new output
    And the footer shows how many lines the view is scrolled back
    And the footer names "f" as the way back to following

  Scenario: New output does not yank a scrolled-back view
    Given the developer has scrolled up from the bottom
    When more lines arrive on that tab
    Then the same lines stay on screen
    And the scrolled-back indicator grows to account for the new lines

  Scenario: Returning to the bottom resumes following
    Given the developer has scrolled up from the bottom
    When the developer presses "f", or End, or scrolls all the way back down
    Then the view tracks new output again
    And the footer's scrolled-back indicator disappears

  Scenario: Slash opens a search prompt in the footer
    When the developer presses "/"
    Then a search prompt appears in the footer
    And normal scrolling and tab-switching keys are captured as text instead

  Scenario: Enter jumps to the nearest match and highlights every match on screen
    Given the developer has typed a query into the search prompt
    When the developer presses Enter
    Then the view jumps to the nearest matching line
    And every occurrence of the query visible in the window is highlighted
    And the search is case-insensitive

  Scenario: n and N step across the whole buffer of the current tab
    Given a committed search with matches above and below the current view
    When the developer presses "n"
    Then the view jumps to the next match forward, wrapping past the last one
    When the developer presses "N"
    Then the view jumps to the previous match, wrapping past the first one

  Scenario: Paging works from a keyboard with no page keys
    Given a laptop keyboard with no page up, page down, home or end
    When the developer presses space or "b"
    Then the view moves a page down or up
    And "d" and "u" move half a page, and "g" and "G" jump to the top and the bottom
    And the footer names those keys rather than the ones the keyboard does not have
    And the page, home and end keys still work where a keyboard has them

  Scenario: Escape clears the search
    Given a committed search is active
    When the developer presses Escape
    Then the query is cleared
    And highlighting disappears
    And Escape once again detaches the viewer as before

  Scenario: A search persists across tabs
    Given a committed search on one log tab
    When the developer switches to another log tab
    Then the same query is still active
    And "n" searches that tab's own buffer, not the previous tab's matches

  Scenario: Existing bindings keep working
    Then digit keys still jump straight to a tab
    And left/right and tab/shift+tab still cycle tabs
    And "q" and Ctrl-C still detach the viewer
    And "X" pressed twice still stops the stack, and once still only warns
    And the session dashboard's own up/down/enter/r/a bindings are unaffected

  Scenario: Captures from lanes that no longer run are not tabs
    Given the capture directory holds a log file last written hours before this viewer opened
    And a lane that is running now writes its own capture
    When the viewer discovers captures
    Then the old capture is not a tab
    And the running lane's capture is a tab
    And the old capture stays readable through haven logs

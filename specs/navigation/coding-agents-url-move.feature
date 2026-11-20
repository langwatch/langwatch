Feature: The personal workspace moves from /me to /coding-agents
  As a developer with bookmarks, emails and CLI output full of /me links
  I want the old addresses to keep working after the move to /coding-agents
  So that a link from before the rename never strands me on a dead page

  The personal workspace is the Coding agents product, so its pages move
  from /me/* to /coding-agents/*. Old addresses redirect to the new ones
  with the request intact: the sub-path, the query string and the hash all
  survive, and the browser history keeps only the new address. CLIs that
  are already installed still print /me links, so the redirects stay.

  @integration
  Scenario: The bare old address lands on the Coding agents home
    When I cold-load "/me"
    Then I land on "/coding-agents"

  @integration
  Scenario: An old deep link keeps its sub-path, query and hash
    When I cold-load "/me/sessions?range=7d#latest"
    Then I land on "/coding-agents/sessions?range=7d#latest"
    And the old address is not kept in the browser history

  @integration
  Scenario: An old address that a project page also matches still moves
    When I cold-load "/me/pull-requests"
    Then I land on "/coding-agents/pull-requests"
    # /:project/pull-requests outranks a /me/* prefix row, so the old
    # sessions and pull requests addresses each have their own row.

  @integration
  Scenario: Every old address a project page also matches lands on Coding agents
    Given the application serves a project page at "/:project/<segment>"
    When I cold-load "/me/<segment>"
    Then I land on "/coding-agents/<segment>" when that is a Coding agents page
    And otherwise I land on "/coding-agents"
    # Twins are derived from every project route, the table's and the
    # modules': "/me/<seg>" and "/me/<seg>/*" for each first segment, plus one
    # per deeper page such as "/:project/annotations/all", which would
    # otherwise outrank "/me/annotations/*". A segment with no Coding agents
    # page drops its sub-path: "/me/traces/abc" lands on "/coding-agents".

  @integration
  Scenario: The old devices address lands on the devices tab
    When I cold-load "/me/devices"
    Then I land on "/coding-agents/configure?tab=devices"

  @integration
  Scenario: An old address moves before the workspace has picked a project
    Given I am signed in and no project has been picked for me yet
    When I cold-load "/me/configure?tab=devices#inventory"
    Then I land on "/coding-agents/configure?tab=devices#inventory"
    # /me is no longer a personal address, so the chrome would hold the page
    # waiting for a project: the redirects run above the chrome.

  @integration
  Scenario: A home page pin saved as /me still reads as Personal home
    Given my default landing page was pinned to "/me" before the move
    When I open the default landing page picker
    Then the "Personal home" option is selected
    # The router forwards the old pin to /coding-agents on landing.

  @unit
  Scenario: The product switcher names the personal workspace Coding agents
    Then the personal product is labelled "Coding agents"
    And it opens on "/coding-agents"

  @unit
  Scenario: The CLI budget request link points at the new address
    When the CLI asks for its budget status and a budget blocks the personal key
    Then the request increase link path is "/coding-agents/budget/request"

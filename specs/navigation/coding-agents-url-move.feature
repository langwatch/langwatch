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
  Scenario: The old devices address lands on the devices tab
    When I cold-load "/me/devices"
    Then I land on "/coding-agents/configure?tab=devices"

  @unit
  Scenario: The product switcher names the personal workspace Coding agents
    Then the personal product is labelled "Coding agents"
    And it opens on "/coding-agents"

  @unit
  Scenario: The CLI budget request link points at the new address
    When the CLI asks for its budget status and a budget blocks the personal key
    Then the request increase link path is "/coding-agents/budget/request"

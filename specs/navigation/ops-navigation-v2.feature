Feature: Internal ops navigation
  As an operator
  I want the internal ops pages in one place
  So that I always know where to find them

  There is one place for them: the OPS and BACKOFFICE groups at the
  bottom of the settings menu. The product sidebars carry no ops
  section at all.

  The settings menu is also the complete list. Every internal ops page
  the route table registers is reachable from it.

  @integration
  Scenario: The product sidebars carry no ops section
    Given I have ops access
    When a product sidebar renders
    Then there is no Ops section in it

  @integration
  Scenario: The settings menu holds the ops groups at the bottom
    Given I have ops access and I am an admin
    When the settings sidebar renders
    Then the OPS and BACKOFFICE groups are the last two groups

  @integration
  Scenario: A reader without ops access sees no ops groups
    Given I do not have ops access
    When the settings sidebar renders
    Then there is no OPS group and no BACKOFFICE group

  @unit
  Scenario: The settings menu reaches every internal ops page
    Given the route table registers the internal ops pages
    When each registered ops address is matched against the settings menu
    Then every one of them is claimed by a menu entry

  # The ops menu lists workspaces, not every tool inside one. Projection
  # replay, the payload store and Deja View all read the event-sourcing
  # substrate, so they are reached from that workspace's own rail — replay
  # was already only a drawer opened from its projections section, so its
  # menu entry pointed at a redirect.
  @unit
  Scenario: The event-sourcing tools are offered inside their workspace
    When the ops menu is built
    Then projection replay, the payload store and Deja View are not top-level ops entries
    And the Event Sourcing entry claims their addresses

  @integration
  Scenario: An ops page renders inside the new settings shell
    When I open an ops page
    Then it renders in the navigation-v2 settings shell
    And the matching settings menu entry is marked as active

  @unit
  Scenario: An ops page is never remembered as the last product
    Given I am on an ops page
    When the landing memory reads the address
    Then it resolves to no product

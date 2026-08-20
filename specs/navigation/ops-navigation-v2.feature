Feature: Internal ops navigation in the new navigation modes
  As an operator on a new navigation mode
  I want the internal ops pages in one place
  So that I always know where to find them

  The ops links used to appear in three places at once, and whether the
  main sidebar showed them depended on an environment variable, a
  per-browser pin flag, and whether the reader was already on an ops
  page. In the new navigation modes there is one place: the OPS and
  BACKOFFICE groups at the bottom of the settings menu. The product
  sidebars carry no ops section at all, and no new-mode surface reads
  the environment variable, the pin flag or the current address.

  The settings menu is also the complete list. Every internal ops page
  the route table registers is reachable from it.

  Devices on the legacy mode keep the current chrome unchanged: the
  environment variable, the pin flag and the on-route behavior all keep
  driving the legacy sidebar exactly as before.

  @integration
  Scenario: The product sidebars carry no ops section
    Given I have ops access
    And the ops pin flag is on
    When a product sidebar renders in a new navigation mode
    Then there is no Ops section in it

  @integration
  Scenario: The settings menu holds the ops groups at the bottom
    Given I have ops access and I am an admin
    When the settings sidebar renders in a new navigation mode
    Then the OPS and BACKOFFICE groups are the last two groups

  @integration
  Scenario: The settings menu shows ops without the pin flag or the environment variable
    Given I have ops access
    And the ops pin flag is off and the environment variable is unset
    And I am not on an ops page
    When the settings sidebar renders in a new navigation mode
    Then the OPS group is still there

  @integration
  Scenario: A reader without ops access sees no ops groups
    Given I do not have ops access
    When the settings sidebar renders in a new navigation mode
    Then there is no OPS group and no BACKOFFICE group

  @unit
  Scenario: The settings menu reaches every internal ops page
    Given the route table registers the internal ops pages
    When each registered ops address is matched against the settings menu
    Then every one of them is claimed by a menu entry

  @integration
  Scenario: An ops page renders inside the new settings shell
    Given my device is on a new navigation mode
    When I open an ops page
    Then it renders in the navigation-v2 settings shell
    And the matching settings menu entry is marked as active

  @unit
  Scenario: An ops page is never remembered as the last product
    Given I am on an ops page
    When the landing memory reads the address
    Then it resolves to no product

  @integration
  Scenario: The current chrome keeps its ops section unchanged
    Given my device is on the legacy mode
    And I have ops access and the ops pin flag is on
    When the current chrome renders
    Then the Ops section is in the main sidebar as before

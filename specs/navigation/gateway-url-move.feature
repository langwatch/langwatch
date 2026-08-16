Feature: Gateway and Governance URLs move to the top level
  As a platform engineer with bookmarks, emails and CLI output full of links
  I want the old /settings/gateway and /settings/governance addresses to keep working
  So that the move to /gateway and /governance never strands me on a dead page

  AI Gateway and Governance pages are organization-wide, so they do not
  belong under /settings. /settings/gateway/* becomes /gateway/*, and the
  governance family (/settings/governance/*, /settings/routing-policies)
  joins the existing top-level /governance/*. Old addresses redirect to the
  new ones with the request intact: the sub-path, the query string and the
  hash all survive, and the browser history keeps only the new address so
  the back button never bounces through the old one. The redirects work on a
  cold load of a pasted link, not only on in-app navigation.

  Background:
    Given I am signed in to an organization that can see the AI Gateway

  @integration
  Scenario: The canonical gateway address renders the gateway
    When I open "/gateway/virtual-keys"
    Then I see the virtual keys page

  @integration
  Scenario: The bare gateway address lands on the virtual keys list
    When I open "/gateway"
    Then I land on "/gateway/virtual-keys"

  @integration
  Scenario: An old gateway deep link lands on the same page at its new address
    When I cold-load "/settings/gateway/virtual-keys/vk_123?tab=usage#limits"
    Then I land on "/gateway/virtual-keys/vk_123?tab=usage#limits"
    And the old address is not kept in the browser history

  @integration
  Scenario: The bare old gateway address lands on the virtual keys list
    When I cold-load "/settings/gateway"
    Then I land on "/gateway/virtual-keys"

  @integration
  Scenario: An old governance deep link lands on the same page at its new address
    When I cold-load "/settings/governance/teams/team_123?range=30d"
    Then I land on "/governance/teams/team_123?range=30d"

  @integration
  Scenario: Routing policies join governance
    When I cold-load "/settings/routing-policies"
    Then I land on "/governance/routing-policies"

  @integration
  Scenario: The retired cost centers address lands on departments
    When I cold-load "/settings/governance/cost-centers"
    Then I land on "/governance/departments"

  @unit
  Scenario: The CLI prints the new gateway address for a virtual key
    When the CLI builds the dashboard link for the virtual key "vk_123"
    Then the link path is "/gateway/virtual-keys/vk_123"

  @unit
  Scenario: A project can never take a reserved top-level address
    Given "gateway" is a reserved top-level address
    When a project is created with the name "gateway"
    Then the project slug it gets is not "gateway"
    And minting a slug that equals a reserved top-level address is refused

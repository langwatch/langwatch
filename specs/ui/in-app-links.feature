# Implementation:
#   packages/browser-host/src/link.tsx
#   packages/design-system/src/components/section-navigation-frame.tsx
#   packages/architecture-enforcer/tests/in-app-links.unit.test.ts

Feature: An in-app link routes in place and never reloads the document
  Main navigated between its pages client-side through the router's link. A
  feature package may not name the router, so the ported links fell back to
  bare anchors and every click reloaded the whole application. The one
  in-app link is `@langwatch/browser-host/link`: a real anchor whose plain
  click goes through the shell's navigation capability. Leaving the
  application stays a document load: the API's own addresses, other origins,
  a new tab, a download and a modified click are the browser's.

  @integration
  Scenario: A plain click on an in-app link routes through the navigation capability
    Given the shell's capabilities are mounted above a link to "/checkout/traces"
    When the reader clicks it with the primary button
    Then the navigation capability is asked for "/checkout/traces"
    And the browser's default navigation is prevented

  @integration
  Scenario: A link to the API's own address is a document load
    Given the shell's capabilities are mounted above a link to "/api/auth/logout"
    When the reader clicks it
    Then the navigation capability is not asked
    And the browser follows the anchor

  @integration
  Scenario: A modified click, a new tab or a download stays the browser's
    Given the shell's capabilities are mounted above an in-app link
    When the reader clicks it with a modifier key, or the link opens a new tab, or it is a download
    Then the navigation capability is not asked

  @integration
  Scenario: An external link opens a new tab
    Given a link marked external to "https://docs.langwatch.ai"
    When the reader clicks it
    Then it opens in a new tab without an opener
    And the navigation capability is not asked

  @integration
  Scenario: A link with no shell above it is left to the browser
    Given no capabilities are mounted above a link to "/checkout/traces"
    When the reader clicks it
    Then the anchor keeps its address and the browser follows it

  @integration
  Scenario: A section rail routes its entries in place
    Given a section navigation rail handed a navigate function
    When the reader clicks one of its entries
    Then the navigate function is asked for that entry's address
    And a modified click on an entry is left to the browser

  @unit
  Scenario: No browser package hard-codes an in-app address on a bare anchor
    Given every browser package and the design system
    When their anchors and Chakra links are read
    Then none carries a literal in-app address
    And no module keeps a local link element that renders an anchor without routing its clicks

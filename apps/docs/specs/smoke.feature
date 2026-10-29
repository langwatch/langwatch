Feature: Smoke test the published documentation

  @e2e
  Scenario: Read the three key pages in both themes and viewport sizes
    Given a production build is served from an isolated preview
    When a reader opens the home page, quick start and trace API reference
    Then each page renders its title without browser errors or horizontal overflow
    And its copy, search and API request controls work
    And empty authentication prevents any API request

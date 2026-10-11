Feature: Generate and run the documentation site
  The same docs.json, MDX and OpenAPI sources drive local development and the static build.

  @unimplemented
  Scenario: Build all configured documentation
    When the documentation build command succeeds
    Then every configured page has static HTML and Markdown
    And the build contains a search index, redirects and a 404 page
    And no unlisted API operation has a page

  @unimplemented
  Scenario: Reject invalid documentation
    Given a configured page has invalid MDX or cannot render
    When the documentation build command runs
    Then it fails with the affected page identified

  @unimplemented
  Scenario: Reload changed source during development
    Given the development server is running
    When an MDX page or its imported snippet changes
    Then the browser displays the updated content without restarting the server
    And search uses the updated source

  @unimplemented
  Scenario: Reload navigation and API definitions
    Given the development server is running
    When docs.json or an OpenAPI document changes
    Then navigation and API pages reflect the changed source without restarting the server

  @unimplemented
  Scenario: Serve directory URLs consistently
    Given the static build is served by preview
    When a reader opens a page with or without a trailing slash
    Then the same documentation page is served
    And configured redirects preserve incoming query parameters
    And an unknown page returns the generated 404 with status 404

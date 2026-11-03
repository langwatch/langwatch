Feature: Generate and run the documentation site
  The same docs.json, MDX and OpenAPI sources drive local development and the static build.

  @e2e
  Scenario: Build all configured documentation
    When the documentation build command succeeds
    Then every configured page has static HTML and Markdown
    And the build contains a search index, redirects and a 404 page
    And no unlisted API operation has a page

  @unit
  Scenario: Reuse a page rendered from unchanged inputs
    Given a previous build rendered a page into the render cache
    When the next build compiles the same page source, snippets, navigation, renderer and dependency versions
    Then the page is taken from the cache instead of being rendered again
    And the published files are byte-identical to a build without the cache
    But a change to the page, an imported snippet, docs.json, CHANGELOG, the shared design system or a renderer dependency renders it again

  @unit
  Scenario: Render pages on a bounded number of workers
    Given the machine has several cores and enough free memory
    When the build renders every page
    Then it renders on at most four independent workers, fewer when memory is short
    And the stylesheet, search index, page files and build version match a single-worker build

  @unit
  Scenario: Reject invalid documentation
    Given a configured page has invalid MDX or cannot render
    When the documentation build command runs
    Then it fails with the affected page identified

  @unit
  Scenario: Reload changed source during development
    Given the development server is running
    When an MDX page or its imported snippet changes
    Then the browser displays the updated content without restarting the server
    And search uses the updated source

  @unit
  Scenario: Reload navigation and API definitions
    Given the development server is running
    When docs.json or an OpenAPI document changes
    Then navigation and API pages reflect the changed source without restarting the server

  @e2e
  Scenario: Serve directory URLs consistently
    Given the static build is served by preview
    When a reader opens a page with or without a trailing slash
    Then the same documentation page is served
    And configured redirects preserve incoming query parameters
    And an unknown page returns the generated 404 with status 404

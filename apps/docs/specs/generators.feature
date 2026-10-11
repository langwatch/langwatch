Feature: Generate documentation data from authored sources

  @unit
  Scenario: Export complete API operations for agents
    Given a frontmatter-only API page points to an OpenAPI operation
    When its Markdown export is generated
    Then it contains its title, endpoint, authentication and parameters
    And request and response schemas and explicit examples are retained
    And an unresolved operation fails instead of producing an empty export

  @unit
  Scenario: Preserve guide metadata in Markdown exports
    Given a guide has a title, description and authored MDX
    When its Markdown export is generated
    Then the title and description precede the readable authored source

  @unit
  Scenario: Index API reference content
    Given an API page has a main content region without an article
    When its search entry is generated
    Then endpoint parameters and response fields are searchable
    And surrounding navigation is excluded

  @integration
  Scenario: Render response arrays and composed schemas
    Given a response contains array items and alternative object schemas
    When the response reference is rendered
    Then item fields and every alternative are visible
    And all response media types retain their declared fields

  @unit
  Scenario: Preserve authored navigation and API slugs
    Given nested navigation, title overrides and unlisted API files
    When navigation and the API inventory are generated
    Then authored order, labels and slugs are preserved
    And unlisted operations are excluded

  @unit
  Scenario: Reject a missing configured source
    Given navigation lists a page with no MDX source
    When navigation is generated
    Then generation fails instead of omitting the page

  @unit
  Scenario: Resolve OpenAPI references and request metadata
    Given an operation uses shared schemas, recursion and security
    When it is resolved
    Then its server prefix, parameters, authentication and examples are retained
    And empty responses remain empty

  @unit
  Scenario: Resolve evaluation operations and absent endpoints
    Given an operation exists only in the evaluation specification
    When operations are resolved
    Then the evaluation operation is returned
    And unknown paths or methods return no operation

  @unit
  Scenario: Preserve redirect queries and destination fragments
    Given redirects include local and external destinations
    When a redirect is resolved with query parameters
    Then destination query values take precedence
    And other incoming parameters and destination fragments are retained
    And unknown paths have no redirect

  @unit
  Scenario: Index article content with navigation context
    Given a rendered page contains navigation, styles and an article
    When its search entry is generated
    Then only the article text is indexed
    And the entry contains its title, description, nested navigation trail and heading anchors

  @unit
  Scenario: Detect broken local links and fragments
    Given a build contains pages, redirects and links
    When its links are checked
    Then missing local pages, assets and fragments are reported with their source page
    And valid redirects, external links and query parameters are handled

  @unit
  Scenario: Publish index aliases and an LLM directory
    Given configured pages include a section index
    When build targets and the LLM directory are generated
    Then both the authored index URL and the section URL resolve to the page
    And the LLM directory lists only configured pages with Markdown links

  @unit
  Scenario: Resolve relative links independently of trailing slashes
    Given authored Markdown and MDX links use relative paths
    When the page is compiled
    Then those links become absolute documentation paths
    And external links and fragment links remain unchanged

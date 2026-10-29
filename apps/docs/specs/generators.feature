Feature: Generate documentation data from authored sources

  @unit
  Scenario: Export complete API operations for agents
    Given a frontmatter-only API page points to an OpenAPI operation
    When its Markdown export is generated
    Then it contains its title, endpoint, authentication and parameters
    And request and response schemas and explicit examples are retained
    And an unresolved operation fails instead of producing an empty export

  @unit
  Scenario: Open an undescribed API operation with a sentence naming its endpoint
    Given an API page and its OpenAPI operation carry no description
    When its Markdown export is generated
    Then a sentence naming the method and path follows the title

  @unit
  Scenario: State a repeated property schema once in API exports
    Given an object schema lists properties whose schema equals its additionalProperties
    When the schema is written into a Markdown export
    Then those properties are left to additionalProperties, unless one is required
    And a property with its own schema is kept

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
    And the alternatives form one "One of N" group of numbered options
    And all response media types retain their declared fields

  @integration
  Scenario: Render nested objects and union options as connected groups
    Given a response field holds child attributes or a union of object shapes
    When the response reference is rendered
    Then the field's disclosure is a quiet text control that counts what it opens, as "Show 3 child attributes" or "Show 2 variants"
    And it reads "Hide" in place of "Show" while open
    And the opened children hang from a left rule under their parent
    And a union option is named by the constant that tells it apart, as kind: "categorical"

  @integration
  Scenario: Render code spans in API descriptions
    Given an operation, response or field description with backticked words
    When the API reference renders it
    Then those words show as inline code, without literal backticks

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
  Scenario: Give each search result its page's icon
    Given pages with their own icon, pages whose group has one and pages with only a section icon
    When the search index is published
    Then each entry names the page's own icon, else its innermost group's, else its section's
    And a bundled icon's drawing is written once, on the first entry naming it
    And a page with no icon at any level names none, and its result shows the generic page icon

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
  Scenario: Section index pages keep their published address
    Given a configured page is a section index such as "ai-governance/ingestion-sources/index"
    When its canonical address, navigation link and Markdown export are generated
    Then they name "/docs/ai-governance/ingestion-sources", the address the docs serve today

  @unit
  Scenario: Resolve relative links independently of trailing slashes
    Given authored Markdown and MDX links use relative paths
    When the page is compiled
    Then those links become absolute documentation paths
    And external links and fragment links remain unchanged

  @unit
  Scenario: Export complete guides with their snippets
    Given a guide imports a snippet and uses it on its own line
    When its Markdown export is generated
    Then the snippet's content stands in its place and the resolved import line is gone
    And root-relative links become https://langwatch.ai/docs addresses outside code
    And the page, source file and llms.txt addresses follow the description
    And MDX import and export lines and {/* */} comments are gone outside code
    But fenced code, unknown components and any other snippet usage are kept as authored

  @unit
  Scenario: Export callouts as labelled blockquotes
    Given a guide with a Tip, Note, Info, Warning or Check callout
    When its Markdown export is generated
    Then the callout is a blockquote that opens with its bold label
    But a callout holding fenced code keeps its label and leaves the code unquoted

  @unit
  Scenario: Export tabs and code groups as labelled blocks
    Given a guide with Tabs or a CodeGroup
    When its Markdown export is generated
    Then each tab's content follows its title in bold
    And each grouped code block follows its title or language in bold, its fence untouched

  @unit
  Scenario: Export steps as numbered headings
    Given a guide with Steps under a section heading
    When its Markdown export is generated
    Then each step is a numbered heading one level below the section, followed by its body

  @unit
  Scenario: Export cards as a link list
    Given a guide with a CardGroup of cards
    When its Markdown export is generated
    Then each card is one list item linking its title, followed by its description

  @unit
  Scenario: Export parameter and response fields as tables
    Given a guide with ParamField or ResponseField elements, some with expandable child fields
    When its Markdown export is generated
    Then consecutive fields become one table of name, type, required and description
    And child fields are rows named under their parent
    But a field whose description holds fenced code is written as a labelled block

  @unit
  Scenario: Export accordions as headings
    Given a guide with an AccordionGroup or Accordion
    When its Markdown export is generated
    Then each accordion is a heading one level below the section, followed by its body

  @unit
  Scenario: Export frames, images and media as Markdown
    Given a guide with a Frame around an image, a video or an iframe
    When its Markdown export is generated
    Then the image is a Markdown image, its caption follows in italics
    And a video or iframe is a link to its source

  @unit
  Scenario: Export inline components as their text
    Given a guide with a Tooltip, an Icon, an expandable section or legacy content
    When its Markdown export is generated
    Then only their readable text is kept

  @unit
  Scenario: Export skill cards as commands and a link to the prompt
    Given a skills page with generated skill card markup and its prompt
    When its Markdown export is generated
    Then each skill is a heading with its install and skill commands
    And its prompt is a link to the prompt's own Markdown file instead of the prompt text

  @unit
  Scenario: Every registered component has a Markdown export
    Given the components the MDX renderer registers
    When the Markdown export converters are listed
    Then every capitalised component name has a converter

  @unit
  Scenario: Robots.txt names each AI crawler
    Given the AI crawlers listed in the agent readiness budgets
    When the discovery files are generated
    Then robots.txt allows each one by name and carries the content signal for it
    And the catch-all group, its content signal and the sitemap line are kept

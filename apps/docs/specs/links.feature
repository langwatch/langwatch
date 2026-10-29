Feature: Keep every published documentation address and link working

  The link check runs over a finished build. It replaces the Mintlify broken-link,
  redirect and URL scripts, and fails a change that would break an address already
  published at https://langwatch.ai/docs.

  @unit
  Scenario: Every published address resolves in the build
    Given the published-address ledger lists site paths
    When a build is checked under its base path
    Then a path that is a page or redirects to a page or an external address passes
    And a path that resolves to nothing is reported as unpublished

  @unit
  Scenario: A new page must be added to the ledger
    Given a build contains a page the ledger does not list
    When its links are checked
    Then the page is reported with an instruction to add it to the ledger
    And updating the ledger appends it in sorted order

  @unit
  Scenario: Redirects point at pages
    Given a build publishes redirects
    When its redirects are checked
    Then a destination that is neither a page nor an absolute https address is reported
    And a destination that is another redirect's source is reported as a chain
    And redirect cycles and destinations with a fragment are reported
    And a pattern source covers the published paths beneath it

  @unit
  Scenario: Links in agent outputs resolve in the build
    Given Markdown exports, llms.txt, llms-full.txt, agents.txt and the sitemap name documentation addresses
    When their links are checked
    Then an address that reaches no page is reported with the file that names it
    And a fragment is checked against the headings of the page it names

  @unit
  Scenario: Sitemap entries are canonical page addresses
    Given a build publishes a sitemap
    When it is checked
    Then each entry equals the canonical address of the page it names
    And entries ending in a slash or in /index are reported
    And a page whose canonical address the sitemap omits is reported

  @unit
  Scenario: Imported snippets exist
    Given authored pages import shared snippets
    When the sources are checked
    Then an import naming a missing snippet is reported with the importing file

  @unit
  Scenario: External links are reported without failing the check
    Given a build links to external addresses
    When external links are checked on request
    Then each address is requested once with bounded concurrency and remembered on disk
    And failures are reported without changing the exit status

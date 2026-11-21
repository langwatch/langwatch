Feature: Publish the documentation as a static site

  The build output is a plain directory any static host can serve: no
  application server, edge function or host-specific configuration.

  @unit
  Scenario: Directory addresses and moved exports redirect as they do today
    Given "/integration" is a directory of pages but not a page itself
    When the documentation is built
    Then "/integration" redirects to the first page under it in reading order
    And a configured redirect or a page at the same path wins over the directory rule
    And the Markdown, ".claude" and ".agent" exports of a moved page redirect to the new page's exports

  @unit
  Scenario: Serve every configured redirect from a static page
    Given a docs.json redirect with an exact source path
    When the documentation is built
    Then the source path publishes a noindex page that refreshes to the destination
    And the page names the destination as canonical and links to it without JavaScript
    But a configured page at the same path is published instead of the redirect
    And pattern sources such as ":path*" stay in redirects.json for hosts with redirect rules
    And on a host without them the 404 page sends a matching pattern address to its destination
    And in-page navigation lands on the destination's address, not the old one

  @unit
  Scenario: The release job's cache-bust redirect is not published
    Given docs.json holds the "/ci/cache/busted/<timestamp>" redirect the release job rewrites
    When the documentation is built
    Then no redirect is published for it

  @unit
  Scenario: The inline scripts keep the hashes the Content-Security-Policy allows
    Given the docs host's Content-Security-Policy allows inline scripts only by their sha256 hash
    When the theme or code-language script changes
    Then a test fails and names the hash the host's policy must allow instead

  @unit
  Scenario: Build with materialized Git LFS assets
    Given docs images, videos and fonts may be stored with Git LFS
    When the documentation checkout has its asset bytes
    Then the static build copies the original asset bytes
    But a remaining LFS pointer makes the build fail before publishing

  @unit
  Scenario: Prerender in a directory owned by one build
    Given two builds run at the same time with different output directories
    When each compiles its prerender bundle
    Then each bundle is written to its own new directory
    And each build removes only its own directory, also when rendering fails

  @unit
  Scenario: Build the documentation under a base path
    Given the production build serves the documentation at the site root
    When a build is given "--base-path /docs"
    Then every site link, asset, font, script and search index address starts with "/docs/"
    And the page data, redirects.json and output directory layout stay unprefixed
    And canonical, Open Graph, sitemap and llms.txt addresses still name https://langwatch.ai/docs
    But a base path that is not a clean "/segment" prefix stops the build

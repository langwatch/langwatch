Feature: Publish the documentation as a static site

  The build output is a plain directory any static host can serve: no
  application server, edge function or host-specific configuration.

  @unit
  Scenario: Serve every configured redirect from a static page
    Given a docs.json redirect with an exact source path
    When the documentation is built
    Then the source path publishes a noindex page that refreshes to the destination
    And the page names the destination as canonical and links to it without JavaScript
    But a configured page at the same path is published instead of the redirect
    And pattern sources such as ":path*" stay in redirects.json for hosts with redirect rules

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
    Then every site link, asset, font, script, search index and service worker address starts with "/docs/"
    And the page data, redirects.json and output directory layout stay unprefixed
    And canonical, Open Graph, sitemap and llms.txt addresses still name https://docs.langwatch.ai at the root
    But a base path that is not a clean "/segment" prefix stops the build

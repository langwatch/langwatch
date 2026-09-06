Feature: The README's links keep pointing at pages that exist
  As someone arriving at the repository for the first time
  I want every link in the README to resolve
  So that the first thing I click is not a 404

  # The README is the one page every new user reads, and its links rot from the
  # outside: a docs page gets renamed and nothing in this repository fails.
  # Nine of its links were dead when this guard was written — seven integration
  # pages that had been renamed under docs/ (`.../integrations/openai` became
  # `.../integrations/open-ai`, `crewai` became `crew-ai`, `vercel-ai` became
  # `vercel-ai-sdk`), and the hybrid-setup page, which had moved out of
  # /self-hosting/ entirely.
  #
  # The check runs on every pull request and on a schedule. It carries no path
  # filter because a filtered workflow here needs a complementary "-unmodified"
  # stub for branch protection to resolve (specs/ci/path-filters.feature), and
  # the check is under a minute. The scheduled run is the one that matters:
  # this rot needs no commit here to happen, because the link dies when the
  # docs site changes, not when this repository does.
  #
  # Only 404 and 410 fail the run. A link check that fails on every non-2xx
  # answer fails on npmjs.com returning 403 to a datacentre IP and on any
  # transient timeout, and a check that cries wolf gets ignored or removed.
  # Those answers are reported and do not gate.

  Background:
    Given the repository's README

  @unit
  Scenario: A markdown link to a page that is gone fails the check
    Given a link whose target answers 404
    Then the check reports that link with its status
    And the check fails

  @unit
  Scenario: A link to a page that has been removed for good fails the check
    Given a link whose target answers 410
    Then the check fails

  @unit
  Scenario: A bot-blocked host does not fail the check
    Given a link whose target answers 403
    Then the check reports it as unverified
    And the check passes
    # npmjs.com answers 403 to CI egress addresses. The package page is fine;
    # the checker is simply not a browser.

  @unit
  Scenario: A redirect to a live page passes
    Given a link whose target answers 301 to a page that answers 200
    Then the check passes

  @unit
  Scenario: A link that times out does not fail the check
    Given a link whose target never answers
    Then the check reports it as unverified
    And the check passes

  @unit
  Scenario: A relative link is resolved against the repository, not the network
    Given a link to "/LICENSE.md"
    Then the check looks for that file in the repository
    And the check passes when the file exists
    # GitHub rewrites a root-relative README link onto the repository's own
    # blob path, so "/LICENSE.md" is a repository path and never a URL.

  @unit
  Scenario: A relative link to a path that no longer exists fails the check
    Given a link to a repository path that is absent from the working tree
    Then the check reports that path
    And the check fails

  @unit
  Scenario: Links inside HTML in the README are checked too
    Given an HTML anchor and an image tag in the README
    Then their targets are checked like markdown links
    # The README's header badges and hero image are raw HTML, not markdown.

  @unit
  Scenario: Anchors, mailto and localhost are not fetched
    Given links to "#section", "mailto:security@langwatch.ai" and "http://localhost:5560"
    Then none of them are fetched
    And the check passes

  @unit
  Scenario: Each distinct target is fetched once
    Given the same URL appears in three places in the README
    Then it is requested once
    # The README links discord.gg and the docs root several times over.

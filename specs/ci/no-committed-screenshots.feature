Feature: No committed screenshots check
  As a maintainer
  I want a PR to fail when it adds images outside the directories where images belong
  So that PR-body and browser-QA screenshots never accumulate in the product tree

  # PR-body and browser-QA screenshots are evidence for a review, not product
  # source. They belong in the github.com/langwatch/pr-screenshots repo, linked
  # from the PR body by raw URL. Committed here they are dead weight the moment
  # the PR merges — and their links, pinned to a branch that is then deleted,
  # 404 anyway.
  #
  # The check is a path allowlist, not a reference scan. "Is this image used
  # anywhere?" flags legitimate docs images too, because many are referenced only
  # by the docs site's own path conventions, so it is the wrong rule.
  Background:
    Given the check judges only the image files a PR adds
    And renaming, moving, or deleting an existing image is not judged
    And images are allowed under docs/images, docs/media, langwatch/public, assets, specs, and python-sdk/examples

  Scenario: A PR that adds no images passes
    Given the PR adds no image files
    Then the check passes

  Scenario: A docs image in an allowed location passes
    Given the PR adds an image under docs/images
    Then the check passes

  Scenario: A screenshot committed to the app tree fails
    Given the PR adds a PNG under langwatch/.pr-screenshots
    Then the check fails
    And the failure names the offending file
    And the failure points to the pr-screenshots repo as the right home

  Scenario: A screenshot dumped into a docs subfolder fails
    Given the PR adds PNGs under langwatch/docs/pairwise-bugfixes
    Then the check fails

  Scenario: An image at the repository root fails
    Given the PR adds an image outside every allowed location
    Then the check fails

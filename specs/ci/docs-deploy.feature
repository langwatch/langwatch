Feature: Deploy the docs to their bucket from main
  As the person responsible for langwatch.ai/docs
  I want main to publish the static docs build itself
  So that the docs need no image, no second repository and no hand step to ship

  # .github/workflows/docs-site.yml `deploy`; the bucket, distribution, redirect
  # store and role are langwatch-saas infrastructure/docs-site.tf.

  @unit
  Scenario: Only main deploys, and only after the docs checks pass
    Given the docs-site workflow
    Then the deploy job needs the verify, build and check jobs
    And it runs only for a push or a dispatch on main
    And it is skipped while the docs bucket variable is unset
    And one deploy runs at a time

  @unit
  Scenario: A deploy caches each file by its name and keeps hashed files
    Given the /docs build the build job uploaded
    Then content-hashed files upload first, as immutable, and are never deleted
    And other static files upload next with an hour's cache
    And Markdown exports upload as text/markdown, revalidated
    And pages and indexes upload last, revalidated
    And only files the build no longer has are deleted, never a hashed one

  @unit
  Scenario: The deploy writes the build's redirects into the edge's redirect store
    Given the build's redirects.json
    When the deploy publishes it
    Then each exact source is one key, and the pattern sources are one list in file order
    And only new or changed keys are written, then keys the build dropped are deleted
    And every update names the store version it read, at most 50 keys at a time
    And a redirect the store cannot hold fails the deploy

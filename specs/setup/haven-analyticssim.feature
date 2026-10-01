@unit
Feature: analyticssim, a local stand-in for PostHog and Customer.io
  The product sends product-analytics events to PostHog (posthog-node on the
  server, posthog-js in the page) and nurturing's identifies and events to
  Customer.io. analyticssim accepts those calls, normalises each into one record
  (provider, kind, distinct id, name, properties, received time, raw call) and
  keeps them in memory, so a developer, apidiff and visualdiff can read what was
  sent. It checks no key: it is a dev shim.

  # Bound by Go tests in services/analyticssim/analyticssim_test.go and
  # tools/thuishaven/domain/overlay_analytics_test.go, by their `// @scenario`
  # annotations, and by apps/analyticssim-web/src/__tests__/records-console.integration.test.tsx.

  Scenario: PostHog calls from either client become records
    Given analyticssim is running
    When posthog-node posts a gzipped batch to /batch/
    And posthog-js posts to /e/ gzipped and as base64 form data
    Then each message is a record from posthog
    And $identify and $set are identifies, $create_alias an alias, $groupidentify a group, anything else an event

  Scenario: Customer.io calls become records
    When nurturing posts identify, track, group or batch to the CDP API under /v1
    And a client calls the Track API's customers PUT and events POST
    Then each call is a record from customerio with its person id, event name and traits or properties

  Scenario: The records can be listed, filtered and cleared
    Given records from both providers
    When a reader lists /_sim/api/records with provider, kind, id or name
    Then it gets the matching records newest first
    And DELETE /_sim/api/records forgets them all

  Scenario: The console lists records by provider and kind
    Given records from both providers
    When the console is open
    Then it lists them newest first, filterable by provider and kind, with each record's properties and raw call

  Scenario: haven runs analyticssim only when the worktree asks for it
    Given a worktree that has never been up
    When the developer runs "haven up"
    Then no analytics lane runs
    When the developer runs "haven up +analytics"
    Then an analytics lane runs analyticssim, routed at analytics.<slug>.langwatch.localhost
    And the overlay sets POSTHOG_HOST and CUSTOMER_IO_BASE_URL to it, with dummy keys where none is set

  Scenario: A developer's own analytics host wins
    Given the worktree's environment already names POSTHOG_HOST or CUSTOMER_IO_BASE_URL
    When the developer runs "haven up +analytics"
    Then the overlay leaves that provider alone

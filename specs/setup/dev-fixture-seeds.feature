Feature: Widget fixture seeds stay on a local stack
  # Upgrade-system audit T7 (2026-10-09): a dev fixture seed never writes into a real installation.
  # Bound by dev/scripts/__tests__/widget-seeds-local-only.unit.test.mjs.
  As a developer seeding dashboard widgets on a local stack
  I want the legacy-parity and north-star widget seeds to refuse any endpoint that is not local
  So that a stray LW_ENDPOINT cannot write fixtures into a real installation or send its key there

  @unit
  Scenario: A widget fixture seed refuses an endpoint that is not a local host
    Given LW_ENDPOINT names a host other than localhost, 127.0.0.1, ::1 or a *.localhost name
    When the legacy-parity or north-star widget seed starts
    Then it exits 1 before sending any request, naming the host it refused

  @unit
  Scenario: A widget fixture seed refuses an endpoint that is not a URL
    Given LW_ENDPOINT is not a URL
    When the legacy-parity or north-star widget seed starts
    Then it exits 1 before sending any request, saying LW_ENDPOINT is not a valid URL

  @unit
  Scenario: A widget fixture seed accepts a local endpoint
    Given LW_ENDPOINT names 127.0.0.1
    When the legacy-parity or north-star widget seed starts
    Then it passes the endpoint check and goes on to talk to that stack

Feature: Every process knows the address this installation answers on
  As someone running LangWatch on Kubernetes
  I want each pod to agree on the installation's public address
  So that callbacks, redirects and sign-in checks are measured against one answer

  # The chart set NEXTAUTH_URL on the app Deployment only. The workers pod runs
  # the same image, so it imports the same auth module, and booted straight into
  # "[better-auth] Base URL could not be determined. Please set a valid base
  # URL": a warning a self-hoster reasonably reads as the cause of whatever
  # else is going wrong that day, and which leaves anything the worker builds
  # off that address pointing at nothing.
  #
  # Bound twice, on purpose: the @unit tests below read the chart templates as
  # text (the regression was textual, the env entry lived on the app Deployment
  # only), and charts/langwatch/tests/e2e-overlays.sh (test_auth_base_url)
  # renders the chart in chart CI to assert value precedence and the
  # once-per-container guarantee on the actual manifests.

  Background:
    Given the LangWatch chart with the workers component enabled

  @unit
  Scenario: The workers pod is told the public address
    When I install with a public URL for the app
    Then the workers container carries that address as its auth base URL
    And the app container carries the same address

  @unit
  Scenario: An install that only names an internal address still agrees with itself
    When I install with a base host and no separate public URL
    Then every container falls back to the base host
    And no container is left without an address

  # Two entries for one key leaves which value wins up to manifest ordering
  # rather than to the chart.
  @unit
  Scenario: The address is declared once per container
    When I render the app deployment
    Then the auth base URL appears exactly once

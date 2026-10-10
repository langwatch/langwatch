# Implementation:
#   packages/browser-host/src/use-router.ts
#   modules/scenario/browser/src/behavior/agent-testing/use-agent-testing-routing.ts
#   modules/scenario/browser/src/behavior/suites/use-suite-routing.ts

Feature: Navigating inside a project keeps the reader in that project
  Main's pages pushed a Next.js route pattern such as
  "/[project]/agent-testing/[[...path]]" with the real address beside it as
  `as`. The shared router took the pattern and dropped the address, so the
  shell read "[project]" as an unknown project and landed the reader on the
  default one. A router push takes one real address; there is no `as`.

  @integration
  Scenario: A section's own navigation pushes the address of the project the reader is in
    Given the reader is on the Agent Testing page of project "other-project"
    When they choose the suite "checkout" in the rail
    Then the router is asked for "/other-project/agent-testing/suites/checkout"
    And it is handed that address alone, with no route pattern beside it

  @integration
  Scenario: A push of a real address navigates to it
    Given the shell's capabilities are mounted on "/checkout/agent-testing"
    When a screen pushes "/checkout/agent-testing/suites/refunds"
    Then the navigation capability is asked for "/checkout/agent-testing/suites/refunds"

  @integration
  Scenario: An in-page move carries no part of the old path into the new address
    Given the reader is on "/checkout/agent-testing/suites/refunds"
    And the router reports the catch-all part "suites/refunds" among its values
    When they open the run plan "nightly" on the Results tab
    Then the router is asked for "/checkout/agent-testing/results/nightly"
    And the address has no query string

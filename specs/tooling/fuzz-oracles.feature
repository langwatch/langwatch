# fuzz judges each answer with fixed rules, no AI. The cross-tenant oracle must
# tell an object of another tenant from one the caller's own key resolved.
#
# Bound by Go tests in tools/fuzz (`go test ./...`), annotated `// @scenario`.

Feature: fuzz oracles name real defects only

  Rule: The cross-tenant oracle reports another tenant's data, not the caller's own

    @unit
    Scenario: An object resolved inside the caller's own tenant is not a cross-tenant hit
      Given a request that addressed another tenant's id
      And the answer names only the caller's own project and organisation
      When the cross-tenant oracle judges the answer
      Then it does not fire

    @unit
    Scenario: An answer naming another tenant's project or organisation is a cross-tenant hit
      Given a request that addressed another tenant's id
      And the answer names a project or organisation that is not the caller's
      When the cross-tenant oracle judges the answer
      Then it fires

    @unit
    Scenario: An answer carrying no tenant field keeps the id-echo rule
      Given a request that addressed another tenant's id
      And the answer echoes that id and names no project or organisation
      When the cross-tenant oracle judges the answer
      Then it fires

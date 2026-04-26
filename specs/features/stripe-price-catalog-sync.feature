Feature: Stripe price catalog sync for SaaS billing
  As a LangWatch SaaS maintainer
  I want billing price ids to be sourced from a synced Stripe catalog file
  So that plan key mapping is validated against Stripe without hardcoded ids in runtime code

  @unit @unimplemented
  Scenario: Billing runtime resolves live price ids in production
    Given stripeCatalog.json has mapping values for test and live
    When the system runs in production mode
    Then billing resolves live price ids for required keys

  @unit @unimplemented
  Scenario: Billing runtime resolves test price ids outside production
    Given stripeCatalog.json has mapping values for test and live
    When the system runs outside production mode
    Then billing resolves test price ids for required keys

  @unit @unimplemented
  Scenario: Extra development prices do not break required mapping validation
    Given the catalog includes additional non-required development prices
    When required keys are all mapped for the detected mode
    Then validation succeeds

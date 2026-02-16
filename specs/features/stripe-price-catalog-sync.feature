Feature: Stripe price catalog sync for SaaS billing
  As a LangWatch SaaS maintainer
  I want billing price ids to be sourced from a synced Stripe catalog file
  So that plan key mapping is validated against Stripe without hardcoded ids in runtime code

  @integration
  Scenario: Sync task fetches Stripe prices for the detected key mode
    Given STRIPE_SECRET_KEY is configured with a valid Stripe key
    When I run the stripe prices sync task
    Then the task fetches prices from Stripe using pagination
    And the generated catalog includes the detected mode prices

  @integration
  Scenario: Sync task enforces required key mappings for current mode
    Given the required billing keys are defined
    When the sync task cannot resolve one required key for the detected mode
    Then the task fails with a validation error

  @integration
  Scenario: Sync task preserves the opposite mode mapping
    Given stripeCatalog.json contains mapping values for both test and live
    When I run the sync task with a test key
    Then the test mapping is updated from Stripe data
    And the live mapping remains unchanged

  @unit
  Scenario: Billing runtime resolves price ids from catalog by NODE_ENV
    Given stripeCatalog.json has mapping values for test and live
    When NODE_ENV is production
    Then billing resolves live price ids for required keys
    When NODE_ENV is not production
    Then billing resolves test price ids for required keys

  @unit
  Scenario: Extra development prices do not break required mapping validation
    Given the catalog includes additional non-required development prices
    When required keys are all mapped for the detected mode
    Then validation succeeds

Feature: Enterprise licensing lifecycle

  @unit
  Scenario: Activate a valid signed license
    Given an organization exists and a current license verifies
    When the licensing service activates the license
    Then it stores validation metadata and provisions only missing retention rules

  @unit
  Scenario: Reject a license that was not signed by LangWatch
    Given a license payload has an invalid signature
    When the licensing service validates it for activation
    Then validation fails and no license state is written

  @unit
  Scenario: Preserve a lapsed self-hosted purchase
    Given a genuine signed license has reached its end date
    When the self-hosted plan source resolves the organization
    Then the signed seat limits and enterprise capabilities remain in its plan

  @unit
  Scenario: Let a lapsed Cloud override step aside
    Given a genuine signed license has reached its end date
    When the active Cloud license source resolves the organization
    Then it returns the free baseline so another entitlement source may apply

  @unit
  Scenario: Inspect platform access for another feature
    Given an optional instance license and organization license candidates
    When the licensing service inspects platform access
    Then it verifies the instance candidate before reading organization candidates
    And it returns the inspected evidence through the portable Licensing contract
    And a signature-valid expired license remains genuine platform access

  Rule: A license activates only where it was sold

    A signed key used to be a bearer token: any unexpired one activated on any
    organization, so a trial key or one scraped from a support thread unlocked
    Enterprise anywhere. Keys now carry the organization they were issued for.

    MIGRATION. Keys minted before the claim existed carry none, and keep
    activating anywhere until they are reissued — the signature is computed over
    the envelope, so adding the claim to an issued key is not possible. Reissue
    outstanding keys with the organization set, and treat a claimless key as the
    bearer token it is until then. Nothing has to be run against a database: the
    claim lives in the key, not in a row.

    @unit
    Scenario: A license activates only on the organization it was issued for
      Given a license issued for one organization
      When an administrator of another organization uploads it
      Then activation is refused and no license state is written
      And that stored license is not platform access for the organization holding it

    @unit
    Scenario: A license minted before the binding existed keeps working
      Given a license that names no organization
      When an organization uploads it
      Then it activates as it always did

  Scenario: Import licensing without side effects
    When a runtime imports the licensing contract or server package
    Then it reads no environment and registers no route, job, or subscriber

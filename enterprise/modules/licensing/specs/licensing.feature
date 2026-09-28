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

    @unit
    Scenario: A licence minted as lic-<uuid> keeps verifying once new licences carry KSUIDs
      Given a licence main signed, whose id is lic-<uuid>
      When this branch validates it beside a licence it minted with a KSUID id
      Then both verify, each under its own id

  Rule: An installation licensed by an organization key is a licensed installation

    A self-hosted deployment is licensed either by an instance key or by a key
    activated on one of its organizations. A process that composes no licence
    mutation still has to read the second kind, or every platform capability
    behind the gate - single sign-on first among them - is refused on an
    installation that paid for it.

    @unit
    Scenario: A process that composes no licence mutation still scans the licence rows
      Given an organization carrying a signed license and no instance license key
      When that process inspects platform access
      Then the stored key is accepted and only the mutation ports refuse

  Rule: Every deployment composes the self-hosted instance registry from its own stores

    Main built the instance registry from Postgres on every deployment. The
    operator's instance list names each install's customer through the
    organization feature, whether or not this process composes the licence registry.

    @integration
    Scenario: A deployment composed from its stores lists installs with their customer's name
      Given an install that reported, attributed to an organization
      When an operator lists the self-hosted instances of a process composed from its stores
      Then the install is listed with the name the organization feature answers

    @unit
    Scenario: The instance list names each install's customer without the licence registry
      Given an install attributed to an organization, and no licence registry composed
      When an operator lists the self-hosted instances
      Then the install is listed with its organization's name

    @unit
    Scenario: An install whose customer the organization feature no longer knows lists without a name
      Given an install attributed to an organization the organization feature does not know
      When an operator lists the self-hosted instances
      Then the install is listed with no organization name

    @unit
    Scenario: A process that composes no stores refuses the instance registry by name
      Given a process composed without stores or an instance registry
      When an operator lists the self-hosted instances
      Then the read is refused naming the self-hosted instance registry

  Scenario: Import licensing without side effects
    When a runtime imports the licensing contract or server package
    Then it reads no environment and registers no route, job, or subscriber

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

  # lic-d6f0f20c-f1f9-4489-bc0a-77b156986b0c was signed by the production key and committed.
  @unit
  Scenario: A revoked license never verifies, whatever key signed it
    Given a license whose id is on the revocation list carries a signature the verifier's key accepts
    When the verifier checks its signature or validates it
    Then it is refused as an invalid signature

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

  Rule: Every deployment composes the licence registry from its own stores

    Main built the licence registry, activation codes and licence sync from
    Postgres on every deployment. The managed keys and the contract budget are
    the gateway's, reached through its operations.

    @unit
    Scenario: The contract budget is the organization's live gateway budget named by the contract's id
      Given the organization's gateway budgets include one carrying the contract's external id
      When licensing reads the organization's contract budget
      Then it answers that budget's limit in cents and whether the customer set the cap

    @unit
    Scenario: An archived contract budget is no contract budget
      Given the organization's only contract budget is archived
      When licensing reads the organization's contract budget
      Then it answers none

  Rule: Licensing owns the licence signing key

    Every licence LangWatch signs is signed by licensing with LANGWATCH_LICENSE_PRIVATE_KEY:
    the registry's issue, renew and seat changes, and a Stripe purchase billing asks it to sign.

    @unit
    Scenario: Licensing signs a purchased licence with its own key
      Given the deployment holds the licence signing key
      When billing asks licensing to sign a purchased licence
      Then the licence verifies against LangWatch's public key

    @unit
    Scenario: A deployment without the licence signing key refuses to sign by name
      Given the deployment holds no licence signing key
      When a peer asks licensing to sign a licence
      Then it is refused as license_signing_not_configured

  Rule: Every deployment composes the hosted Connect services from their owners

    Main composed the hosted services on every deployment: instant-eval judges a hosted call,
    prices it at its judge's rate and records the spend under the calling key; the gateway keeps
    the budgets a connected install reads.

    @integration
    Scenario: A hosted judgement is priced at the rate of the judge that made it
      Given LangWatch Cloud judges hosted calls with a judge at its own rate and markup
      When licensing asks what a judgement's input tokens were worth
      Then it is told the cost and the customer price at that judge's rate

    @integration
    Scenario: A hosted judgement stops when the calling install hangs up
      Given a hosted classify call is being judged
      When the calling install's request is abandoned
      Then the judge is handed that request's signal

    @integration
    Scenario: Hosted spend is billed to the calling key on the spend spine
      Given the spend spine is registered
      When a hosted call's spend is recorded
      Then one outcome at the customer price is recorded under the project's organization and the calling key

    @integration
    Scenario: Hosted spend is refused while the spend spine is not registered
      Given the spend spine is not registered
      When a hosted call's spend is recorded
      Then the record is refused, so the caller keeps the spend and tries again

    @unit
    Scenario: Hosted usage lists only the budgets that apply to the calling key
      Given the organization has budgets of which only some apply to the calling key
      When a connected install reads its hosted usage
      Then only the applicable budgets are listed, and the contract budget is marked as the contract

    @unit
    Scenario: Hosted usage reports spend as unknown when live spend cannot be read
      Given live spend cannot be read
      When a connected install reads its hosted usage
      Then each budget's spend is unknown rather than zero

  Rule: The hosted Connect routes answer behind the gateway's own signed-call door

    Main mounted the hosted routes behind the gateway's signature check. The gateway hands its
    door out through its Api, so the hosted family verifies the same signature, never a copy.

    @unit
    Scenario: A hosted call with a bad signature is refused before any route runs
      Given the Go data plane's call is not signed with the gateway's secret
      When it reaches a hosted Connect route
      Then it is refused as unauthenticated and no licence is read

    @unit
    Scenario: A signed hosted call from a key without a licence is refused by its code
      Given a correctly signed hosted call from a key no licence carries
      When it asks for a hosted judgement
      Then it passes the gateway's door and is refused as connect_service_not_entitled

  Scenario: Import licensing without side effects
    When a runtime imports the licensing contract or server package
    Then it reads no environment and registers no route, job, or subscriber

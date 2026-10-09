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

  Rule: Licensing keeps each organization's licence in its own table

    Round 37 (D6) moved the licence and its dates from organization's columns
    to a table licensing owns. Until organization reads the licence through
    LicensingApi, every write also lands on organization's columns, and an
    organization licensing holds no row for is read from those columns. Once
    no old image is still writing, a background step copies the rest and
    overwrites any row that differs from organization's columns (R42).

    @unit
    Scenario: A stored licence lands on licensing's own row and on organization's columns
      Given an organization with no licence
      When licensing stores a licence for it and later removes it
      Then licensing's own row holds the key, and then a cleared licence
      And organization is told each write, before licensing keeps it

    @unit
    Scenario: A cleared licence is never read back from organization's columns
      Given an organization whose columns still hold a key
      When licensing removes its licence
      Then licensing reads no key for it and leaves it out of the platform-access scan

    @unit
    Scenario: A licence activated before the move is read from organization's columns until it is copied
      Given an organization whose licence is only on organization's columns
      When licensing reads its licence or scans for licensed organizations
      Then it answers the key from organization's columns

    @unit
    Scenario: The worker brings licensing's licence rows level with organization's columns
      Given organizations whose licences are only on organization's columns
      And one whose row differs from its columns and one whose row matches them
      When the licence copy runs twice
      Then the first run copies each missing licence with its dates and overwrites the row that differs
      And the second run copies nothing and organization's columns are as they were

    @unit
    Scenario: A licence cleared on organization's columns alone is cleared on licensing's row
      Given an organization whose row holds a key its columns no longer hold
      When the licence copy runs
      Then licensing reads no key for it and leaves it out of the platform-access scan

    @unit
    Scenario: The licence copy keeps a row written after it read
      Given a licence copy that has read an organization's row
      When licensing writes that organization's licence before the copy overwrites it
      Then the copy leaves the row licensing wrote

    @unit
    Scenario: A dry run of the licence copy writes nothing
      Given organizations whose licences are only on organization's columns
      When the licence copy runs as a dry run
      Then it reports how many it would copy, saves no checkpoint and copies nothing

    @unit
    Scenario: An interrupted licence copy resumes after the last organization it saved
      Given a licence copy that saved its checkpoint after the first batch
      When the copy runs again from that checkpoint
      Then it copies only the organizations after the saved one

    @unit
    Scenario: The worker collects licensing's licence copy as a background step
      Given the licensing module installed on a worker
      When the worker collects its migration steps
      Then the licence copy is a background data step that waits for old writers to go

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
    Scenario: Hosted usage resolves no team for a project authz does not know
      Given the calling key names a project authz holds no scope for
      When a connected install reads its hosted usage
      Then the budgets are resolved with no team rather than the read failing

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

  @unit
  Scenario: A hosted service's state names which half said no
    Given an organization whose license may or may not name a hosted service
    And an administrator may have switched that service off
    When licensing is asked for that service's state
    Then it answers whether the license names it and whether it is still on, without calling LangWatch
    And a deployment with Connect switched off answers neither

  @unit
  Scenario: Import licensing without side effects
    When a runtime imports the licensing contract or server package
    Then it reads no environment and registers no route, job, or subscriber

  Rule: Licensing records a newly licensed self-hosted customer as a fact; organization creates its row

    Licensing mints the organisation id when it licenses a new self-hosted customer and records
    lw.licensing.self_hosted_customer_licensed. Organization subscribes and creates the row under
    that id, so licensing never writes organization's tables or calls it to create one.

    @unit
    Scenario: Organization creates a newly licensed customer's organisation under licensing's id
      Given licensing has recorded that it licensed a new self-hosted customer under an id it minted
      When organization receives the fact
      Then an organisation with that id and the customer's name exists, marked as a self-hosted customer

    @unit
    Scenario: A redelivered self-hosted customer fact creates no second organisation
      Given organization has applied licensing's self-hosted customer fact once
      When the same fact is delivered again
      Then there is still exactly one organisation, the one the first delivery created

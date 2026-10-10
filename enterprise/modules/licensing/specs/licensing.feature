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
    organization is read from those columns where licensing holds no row for it
    or the columns were written after the row. Once no old image is still
    writing, a background step copies the rest and overwrites a row that
    differs from organization's columns written after it (R42; newest wins,
    Alex 2026-10-09).

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
    Scenario: A licence written to organization's columns after licensing's row is read from them
      Given an organization whose row of licensing's holds a key
      When an old image writes another key to organization's columns afterwards
      Then licensing reads the columns' key, and the platform-access scan lists it

    @unit
    Scenario: The worker brings licensing's licence rows level with organization's columns
      Given organizations whose licences are only on organization's columns
      And one whose row differs from columns written after it, one whose row differs from older columns, and one whose row matches
      When the licence copy runs twice
      Then the first run copies each missing licence with its dates and overwrites the row older than its differing columns
      And it leaves the row newer than its columns
      And the second run copies nothing and organization's columns are as they were

    @unit
    Scenario: A licence cleared on organization's columns alone is cleared on licensing's row
      Given an organization whose row holds a key its columns, written after it, no longer hold
      When the licence copy runs
      Then licensing reads no key for it and leaves it out of the platform-access scan

    @unit
    Scenario: The licence copy keeps a row written after it read
      Given a licence copy that has read an organization's row
      When licensing writes that organization's licence before the copy overwrites it
      Then the copy leaves the row licensing wrote

    @unit
    Scenario: The licence copy keeps a licence written to both sides between its reads
      Given a licence copy that has read organization's columns but not yet licensing's row
      When a live write puts the same licence on both sides before the copy reads licensing's row
      Then the copy leaves both sides holding the licence that write put there

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

  Rule: Licensing records that a customer's contract terms moved

    The contract budget follows the customer's terms, and the budget is connect's. Licensing says only
    that the terms moved, as a fact on the licensing_customer aggregate keyed by the organization;
    connect syncs the budget from it, seconds later.

    @unit
    Scenario: Issuing, revoking, changing terms or linking a licence records contract_terms_changed
      Given a licence registry that records licensing's customer facts
      When an operator issues, revokes, changes the terms of, or links a licence to an organization
      Then each change records a contract_terms_changed fact for the licence's organization
      And moving a licence between organizations records one for the organization it left as well

    @unit
    Scenario: A licence linked to no organization records no contract_terms_changed fact
      Given a licence that no organization carries
      When an operator revokes it or changes its terms
      Then no contract_terms_changed fact is recorded

    @unit
    Scenario: Each contract_terms_changed fact is its own message
      Given the same operator changes the same organization's terms twice, a moment apart
      When both facts are recorded
      Then they carry different idempotency keys, so neither is dropped as a repeat

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

  Rule: Licensing answers which active licence a managed key runs under

    The hosted Connect routes are the connect module's; whether the calling key belongs to an
    active licence of the calling organization, and what that licence is entitled to, is licensing's.

    @unit
    Scenario: findManagedKeyLicense answers the active licence behind a managed key, empty otherwise
      Given licences held by managed keys, some revoked, expired or of another organization
      When a peer asks which active licence of an organization holds one managed key
      Then an active licence of that organization answers as one entry naming its entitled services
      And an active licence entitled to no hosted service answers as one entry with no services
      And a revoked, expired or other organization's licence, or none, answers empty

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

  Rule: Organization keeps licensing's Connect facts on its own row
    Licensing records that an administrator switched a hosted service and how a
    license sync ended; organization writes its own columns from those facts.

    @unit
    Scenario: Licensing records a stored or cleared licence as a fact for organization to apply
      Given licensing stores an organization's licence and later clears it
      When each write lands
      Then licensing records a licence-stored fact with the key's fingerprint and its dates, never the key, then a licence-cleared fact
      And it writes organization's licence columns through no organization operation

    @unit
    Scenario: Organization mirrors the licence licensing stored and clears it when licensing does
      Given organization subscribes to licensing's licence facts
      When licensing records a licence stored and then cleared
      Then organization's licence columns hold the key read from licensing's row and the fact's dates, then hold none

    @unit
    Scenario: Licensing records a hosted-service switch as a fact for organization to apply
      Given an administrator switches a hosted service off for their organisation
      When licensing records the switch
      Then it records a fact naming the organisation, the service and the switch
      And it writes nothing to organization's row

    @unit
    Scenario: Organization keeps a hosted service an administrator switched off
      Given licensing has recorded that an administrator switched a hosted service off
      When organization receives the fact, once or more than once
      Then the organisation's switched-off services name it exactly once
      And switching it back on removes it

    @unit
    Scenario: Organization keeps how the last license sync ended
      Given licensing has recorded that a license sync landed and then that one failed
      When organization receives each fact in order
      Then the organisation keeps when the sync last landed and the code the latest one failed on

    @unit
    Scenario: Licensing records ending or re-resolving a licence's managed key as a fact for gateway to apply
      Given a licence whose managed key licensing must end, and another whose install binding was reset
      When licensing ends the first key and asks for the second to be resolved again
      Then it records a managed-key-retired fact naming the key, its organisation and the actor
      And a managed-key-invalidated fact naming the other key and its organisation

    @unit
    Scenario: Licensing records a licence's connect credential issued as a fact for gateway to provision
      Given a bound licence with no managed key
      When its token is resolved
      Then licensing records a connect-credential-issued fact naming the licence, its install, the token's registry hash and its services, never the token
      And the call answers connect_credential_pending

    @unit
    Scenario: Licensing attaches gateway's provisioned key once, however often the fact arrives
      Given gateway has recorded a managed key provisioned for a licence
      When licensing receives the fact once and then again
      Then the licence holds that key and nothing is ended on the repeat

    @unit
    Scenario: Gateway ends or re-resolves a licence's managed key from licensing's fact, however often it arrives
      Given gateway subscribes to licensing's managed-key facts
      When a managed-key-retired fact arrives once and then again
      Then gateway revokes that key under the fact's organisation and actor, the same revoke each time
      And a managed-key-invalidated fact asks every gateway to resolve that key's licence again

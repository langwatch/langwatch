Feature: Enterprise single sign-on onboarding - three tiers, in priority order
  As a LangWatch operator, and as the administrator of a company that runs
  LangWatch itself
  I need a connection to go from nothing to routing real sign-ins without
  anybody editing a database
  So that enterprise onboarding is a handful of guarded commands rather than
  a support ticket that ends in hand-written SQL

  # D05 (ADR-117 §5, ADR-027 as amended; ADR-101 §4 for what a fact may
  # carry). Everything here drives D04's connection lifecycle through the
  # verbs it already has. This deliverable adds surfaces, permissions and
  # ceremonies - and not one guard.
  #
  # OIDC ONLY. The connection is protocol-agnostic on purpose, so SAML
  # arrives later as one more way to terminate a connection, and the engine
  # choice - ADR-117's named debt - moves to D09, where a named customer's
  # connection defines the requirement instead of a guess. Registering a
  # SAML connection through any of these surfaces is refused by name.
  #
  # Three tiers. They differ in WHO drives the setup and WHAT authorizes the
  # domain. They never differ in which guards run:
  #
  #   TIER 1  ops-assisted, hosted                        BUILD FIRST
  #     an operator, in the back office
  #     register -> claim -> approve -> attest -> activate
  #     no queue, because the person who would staff one is already here;
  #     and no round-trip to the customer, because the operator who approved
  #     the claim attests the domain in the same sitting. Attestation is a
  #     D04 amendment (see sso-connection-lifecycle.feature): it replaces the
  #     PROOF, never the approval, so the trust decision is the same audited
  #     operator act it always was. The only thing left that needs the
  #     customer is somebody completing a test sign-in, which is the entire
  #     point of a test sign-in.
  #
  #   TIER 2  self-hosted self-serve, licence-bound       SECOND, SIMPLEST
  #     an organization administrator, in Settings
  #     register -> claim -> approve (the licence) -> prove (licence) ->
  #     activate
  #     no LangWatch in the loop at all. There is nobody to reach, so the
  #     enterprise licence IS the authorization: no claim queue, no
  #     approval step of ours, no DNS ceremony. This tier is genuinely
  #     smaller than tier 3, not larger.
  #
  #   TIER 3  hosted self-serve                           LAST, SEPARABLE
  #     an organization administrator, in Settings
  #     register -> claim -> [waits for LangWatch] -> approve ->
  #     prove (DNS record) -> activate
  #     the only tier that lets a stranger claim a domain, and the only one
  #     that waits on a queue somebody has to staff. Who staffs it and how
  #     fast is unresolved (epic Open Q2), so this tier may ship late or
  #     never, and nothing in tiers 1 and 2 waits for it.
  #
  # Ship order is value order. Tier 1 alone ends database surgery and makes
  # hosted onboarding ours to finish in minutes. Tier 2 alone is the whole
  # difference between a self-hosted customer having single sign-on and not
  # having it. Tier 3 is the remainder.
  #
  # The surfaces are the ones that already exist. Tier 1 extends the back
  # office - the same list shell, the same search, the same paging, the same
  # overflow menu per row, the same drawer for detail - and replaces the two
  # free-text single sign-on fields on the organization record with the
  # connection itself. Tiers 2 and 3 extend organization Settings.
  #
  # Gated per organization by SELF_SERVE_SSO. Rollback is the flag: the
  # surfaces are additive and the commands underneath them are D04's.

  Background:
    Given an organization "acme" whose administrator "ana" may manage single sign-on
    And a LangWatch operator "olive" with platform operator access
    And "acme" has no single sign-on connection yet

  # ── What a tier is, and what it is not ─────────────────────────────────

  @unit @unimplemented
  Scenario: Every tier drives one connection through one lifecycle
    Given a connection that reached live traffic through any of the three tiers
    When its history is read back
    Then the same states were recorded in the same order
    And no tier skipped a guard, and no tier recorded a state another cannot

  @integration @unimplemented
  Scenario: A tier that has not shipped never blocks one that has
    Given this installation offers no way for a customer to claim a domain themselves
    When an operator onboards a customer from the back office
    Then the connection reaches live traffic
    And nothing in the journey waited on a queue

  @unit @unimplemented
  Scenario: Which tier a connection came through stays readable afterwards
    Given connections set up by an operator, by a licensed self-hosted administrator, and through a reviewed claim
    When each connection's history is read
    Then each says who authorized its domain and what proved it
    And a dispute about a domain is answerable from that history alone

  # ── Tier 1: an operator sets a customer up ─────────────────────────────

  @integration @unimplemented
  Scenario: An operator takes a customer from nothing to a connection ready to go live
    When "olive" registers "acme"'s identity provider, claims "acme.com", approves the claim and attests the domain
    Then the connection is ready to activate before "olive" leaves the page
    And every step is recorded as a separate fact with "olive" named on it

  @integration @unimplemented
  Scenario: Setting a customer up asks the customer for nothing until they sign in
    Given "olive" has attested "acme.com" for "acme"
    When the setup is read back
    Then the only thing still wanted from "acme" is somebody completing a test sign-in
    And "acme" was never asked to publish a record or to wait for anybody

  @integration @unimplemented
  Scenario: What proved the domain is on the connection wherever it is read
    Given "olive" attested "acme.com"
    When the connection is opened, in the back office or from the operator lookup
    Then it says the domain was attested, by whom, and when
    And it never reads as a domain the customer proved

  @unit @unimplemented
  Scenario: The operator approving the claim they just made is recorded as exactly that
    When "olive" claims a domain and approves it
    Then both facts are recorded, each naming "olive"
    And nothing on the connection implies a second person reviewed it

  @integration @unimplemented
  Scenario: Activation from the back office needs everything activation ever needs
    Given "acme"'s domain is proved but nobody has completed a test sign-in
    When "olive" activates the connection
    Then the activation is refused with the code "sso_connection_activation_blocked"
    And the words name the proved domain, the test sign-in, and a way back in without the identity provider

  @integration @unimplemented
  Scenario: The connection list behaves like every other back-office list
    When "olive" opens the single sign-on connections list
    Then it searches, pages and shows its loading and empty states the way the other back-office lists do
    And each row's actions are in that row's overflow menu, with removal set apart as destructive

  @integration @unimplemented
  Scenario: A connection's detail opens beside the list, not on a page of its own
    When "olive" opens a connection from the list
    Then its state, its domains, its identity provider reference and its history open in a drawer
    And closing the drawer returns to the list where it was

  @unit @unimplemented
  Scenario: The connections page is reachable from the operator menu
    Given the operator menu offers the single sign-on connections page
    When each menu link is resolved against the application's route table
    Then the connections entry resolves to a route registered for that exact path
    And no entry falls through to the catch-all route

  @unit @unimplemented
  Scenario: An operator cannot change a connection except by commanding it
    When "olive" changes anything about a connection
    Then the change is a guarded command carrying "olive" as the actor
    And no field on the surface writes straight to storage

  @integration @unimplemented
  Scenario: The old single sign-on fields stop being where single sign-on is set up
    Given connection routing decides sign-ins on this installation
    When "olive" edits the organization's older single sign-on domain or provider fields
    Then the edit is refused with the code "sso_connection_string_edit_retired"
    And the words point at the organization's connection instead

  @integration @unimplemented
  Scenario: Removing a live connection states its own risk before it happens
    Given "acme"'s connection is routing sign-ins
    When "olive" starts removing it
    Then the confirmation names "acme" by name and says who would lose their way in
    And the removal is refused outright when the organization's name cannot be resolved

  # ── Tier 2: self-hosted, and the licence is the authorization ──────────

  @integration @unimplemented
  Scenario: A self-hosted administrator sets single sign-on up with nobody else involved
    Given a self-hosted installation holding a genuine licence
    When "ana" registers the identity provider and claims "acme.com" in Settings
    Then the claim is approved on the licence's authority in the same step
    And nothing is queued for LangWatch to look at

  @integration @unimplemented
  Scenario: The licence proves the domain, so there is no record to publish
    Given a self-hosted installation holding a genuine licence
    When "ana" asks to prove "acme.com"
    Then she is asked to confirm the installation's licence rather than publish anything
    And the domain is proved without her leaving the page

  @unit @unimplemented
  Scenario: The proof is recorded as a hash and the identity provider's secret is not recorded at all
    When a domain is proved by any ceremony
    Then the recorded fact carries the proof's hash and a reference to the identity provider's configuration
    And neither the proof itself nor any secret appears in any recorded fact

  @integration @unimplemented
  Scenario: An unlicensed self-hosted installation is told what would change that
    Given a self-hosted installation holding no genuine licence
    When "ana" opens single sign-on setup
    Then setup is refused with the code "sso_license_required"
    And the words name activating a licence, and name no environment variable, host or internal service

  @unit @unimplemented
  Scenario: A licence activated while the installation is running takes effect at the next restart
    Given a self-hosted installation that was unlicensed when it started
    When a genuine licence is activated and single sign-on setup is opened
    Then setup stays unavailable until the installation restarts
    And the page says a restart is needed and does not pretend otherwise

  @integration @unimplemented
  Scenario: The only connection on an installation still leaves a way in
    Given a self-hosted installation about to activate its only connection
    When "ana" activates it
    Then activation is available only while somebody holds a live way in that does not use the identity provider
    And that local way in keeps working after activation

  @unit @unimplemented
  Scenario: A self-hosted administrator is not offered attestation either
    Given a self-hosted installation holding a genuine licence
    When "ana" asks to prove "acme.com"
    Then the licence is what proves it
    And attesting the domain is not something she can reach

  @unit @unimplemented
  Scenario: The licence-bound path is not offered to a hosted organization
    Given "acme" is on the hosted service
    When "ana" opens single sign-on setup
    Then the licence-bound proof is not offered
    And proving the domain means publishing the record LangWatch gives her

  # ── Tier 3: hosted self-serve, a claim, a record, and a queue ──────────

  @integration @unimplemented
  Scenario: A hosted administrator claims a domain and is told it is waiting
    Given "acme" has been opted in to setting single sign-on up itself
    When "ana" registers the identity provider and claims "acme.com"
    Then the claim waits for LangWatch, and "ana" is told so in words that say what happens next
    And nothing about "acme.com" routes any sign-in while it waits

  @unit @unimplemented
  Scenario: The domain cannot be proved while the claim is still waiting
    Given "acme"'s claim on "acme.com" is waiting for LangWatch
    When "ana" asks to prove the domain
    Then the request is refused with the code "sso_domain_claim_pending"
    And the words say the claim is being looked at, and nothing about who is looking

  @integration @unimplemented
  Scenario: A rejected claim says why, and the domain can be claimed again
    Given "acme"'s claim on "acme.com" was rejected with a note
    When "ana" opens single sign-on setup
    Then she reads the note the reviewer wrote
    And claiming the domain again is available without registering a second connection

  @unit @unimplemented
  Scenario: A domain another live connection already holds is refused without naming who holds it
    Given "acme.com" is already proved on another organization's live connection
    When "ana" claims "acme.com"
    Then the claim is refused with the code "sso_connection_domain_taken"
    And the refusal names neither the other organization nor anybody in it

  @integration @unimplemented
  Scenario: A published record proves the domain, and a missing one says exactly that
    Given "acme"'s claim on "acme.com" is approved and the record has not been published
    When "ana" asks LangWatch to look for it
    Then the answer is a refusal with the code "sso_domain_proof_not_found"
    And the record to publish is still on screen, unchanged, with the same value as before

  @unit @unimplemented
  Scenario: An expired proof verifies nothing and a fresh one costs no progress
    Given the record "acme" was given has passed its expiry
    When the record is found on the domain
    Then it proves nothing
    And asking again issues a fresh record against the same claim, with the claim's approval intact

  @integration @unimplemented
  Scenario: How long a claim waited is recorded from the day the queue exists
    Given claims from several organizations are waiting for LangWatch
    When the queue is opened
    Then the longest-waiting claim is first
    And how long each one has waited is recorded and readable afterwards

  @unit @unimplemented
  Scenario: A customer proving their own domain is the whole point of this tier
    Given "acme" is setting single sign-on up itself on the hosted service
    When "ana" looks for a way to skip publishing the record
    Then there is none, because attesting a domain is a LangWatch operator's act
    And her domain is proved by the record she publishes, or not at all

  @unit @unimplemented
  Scenario: Setting single sign-on up yourself is unavailable until the organization is opted in
    Given "acme" has not been opted in to setting single sign-on up itself
    When "ana" opens single sign-on setup
    Then it is refused with the code "sso_self_serve_unavailable"
    And the words offer talking to LangWatch, and name no flag

  # ── Only OIDC, and it says so ──────────────────────────────────────────

  @unit @unimplemented
  Scenario: Setting up a SAML connection is not something anybody does themselves yet
    When a SAML connection is registered through the back office or through Settings
    Then it is refused with the code "sso_saml_not_self_serve"
    And the words say to talk to LangWatch, and name no protocol engine, library or future release

  @integration @unimplemented
  Scenario: A connection carried over from an earlier configuration is untouched by that refusal
    Given an organization whose connection was created from the configuration it already had
    When its users sign in
    Then nothing about their sign-in changes
    And only a newly registered connection meets the refusal

  # ── A way back in, and its expiry ──────────────────────────────────────
  #
  # Whether an installation holding exactly one live connection sends people
  # straight to it is the router's decision, bound by signin-router.feature,
  # and nothing here restates it. What D05 adds is the way in when it does.
  # Whether a single connection may override that installation-wide default
  # is still open (epic Open Q6) and is deliberately unspecified here.

  @integration @unimplemented
  Scenario: Activation needs somebody who can still get in without the identity provider
    Given nobody in "acme" holds a way in that does not use the identity provider
    When activation is attempted on any tier
    Then it is refused with the code "sso_connection_activation_blocked"
    And granting somebody that way in, with a date it ends, makes activation available

  @unit @unimplemented
  Scenario: A way back in ends on its own date, and says so before it does
    Given somebody in "acme" holds a way in that ends in fourteen days
    When each of fourteen, seven and one day remain
    Then whoever can renew it is told, each time, naming the person and the date
    And on the date it ends it stops working, with nobody having to act

  @integration @unimplemented
  Scenario: Renewing a way back in is deliberate and recorded
    When a way back in is renewed
    Then the renewal records who granted it, to whom, and until when
    And the date it previously ended is still readable in the history

  @unit @unimplemented
  Scenario: The local sign-in path is recorded and rate limited
    Given an installation whose only connection routes every sign-in
    When somebody signs in through the local path instead
    Then the sign-in is recorded with who used it
    And repeated attempts are refused the way this installation refuses repeated sign-ins

  # ── Directory provisioning tokens belong to a connection ───────────────

  @integration @unimplemented
  Scenario: A new directory provisioning token belongs to one connection
    Given "acme" holds a live connection
    When "ana" issues a directory provisioning token
    Then the token is issued against the connection she named
    And its secret is shown once and never shown again

  @unit @unimplemented
  Scenario: Issuing a token without naming a connection is refused
    Given "acme" holds two live connections
    When a directory provisioning token is issued without naming one
    Then it is refused with the code "scim_token_requires_connection"
    And the words say to pick the connection the directory will provision through

  @unit @unimplemented
  Scenario: Tokens issued before connections existed keep exactly the reach they had
    Given "acme" holds a directory provisioning token issued before it had a connection
    When the token is used
    Then it works as it always did
    And nothing quietly attaches it to a connection

  @integration @unimplemented
  Scenario: Removing a connection ends the tokens issued against it
    Given a directory provisions "acme" through a token issued against its connection
    When the connection is removed
    Then the token stops being accepted
    And the directory's next push is refused rather than quietly ignored

  # ── Permissions, real from the first day ───────────────────────────────

  @unit @unimplemented
  Scenario: A role holding only the single sign-on permissions can do only that
    Given a custom role holding only the single sign-on and directory provisioning permissions, bound across the organization
    When somebody holding it opens organization settings
    Then they can set up and manage single sign-on and directory provisioning
    And nothing else the organization holds is readable or changeable by them

  @unit @unimplemented
  Scenario: Seeing single sign-on and changing it are two different permissions
    Given somebody who may see single sign-on but not manage it
    When they open the single sign-on settings
    Then the connection, its domains and its state are readable
    And no control they cannot use is rendered for them at all

  @unit @unimplemented
  Scenario: The single sign-on permissions are granted across an organization or not at all
    When a grant of a single sign-on permission is attempted on one team or one project
    Then the grant is refused
    And only a grant across the whole organization is accepted

  @integration @unimplemented
  Scenario: An administrator without the permission is not offered setup, and cannot reach it
    Given "ana" may administer "acme" but may not manage single sign-on
    When she opens organization settings
    Then no single sign-on setup entry is offered
    And opening the address directly is refused

  @unit @unimplemented
  Scenario: Approving somebody else's domain claim is an operator's act, not an administrator's
    Given "ana" holds every permission her organization can grant
    When she tries to approve her own organization's domain claim
    Then the approval is refused
    And approving it stays available only to a LangWatch operator

  # ── Failures are named, never generic ──────────────────────────────────

  @unit @unimplemented
  Scenario: Every refusal on these surfaces carries a code and words written for a customer
    When any onboarding step is refused for a reason we can name
    Then the answer carries a stable code
    And the words the reader sees are the ones registered for that code, never the code and never "unknown"

  @unit @unimplemented
  Scenario: A failure we cannot name degrades honestly and stays traceable
    Given a step fails for a reason nobody anticipated
    When the reader is told
    Then they are told it did not work and given something to quote back to us
    And nothing invents a cause the reader could act on

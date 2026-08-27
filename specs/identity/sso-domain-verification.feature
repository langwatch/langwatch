Feature: Proving a domain by publishing a record
  As the administrator of a company setting single sign-on up on the hosted
  service
  I need the record LangWatch asks for to be exact, and the answer to
  "is it there yet" to be honest
  So that my domain is proved by something I control, and I am never sent to
  fix DNS that is already correct

  # D05 tier 3's DNS leg (ADR-117 §5; the lifecycle it drives is D04's, in
  # sso-connection-lifecycle.feature; the tier it belongs to is in
  # sso-onboarding-tiers.feature).
  #
  # The lifecycle rules below - a published record as a claim-approval
  # authority nobody may assert, the disputes-only operator queue, the abuse
  # rails, and the wavering/lapse re-verification with what a lapse does and
  # does not stop - are ADR-123, `dev/docs/adr/123-a-domain-is-proved-by-a-
  # record-that-stays-published.md`. The guards are where they are enforced;
  # this file is where they are readable.
  #
  # THE RECORD. A TXT record at `_langwatch-verification.<domain>`, whose
  # value is the token we minted and nothing else.
  #
  # A dedicated label rather than the apex, and that choice is what lets the
  # value be a bare token. The apex is a shared shelf - every vendor a
  # company uses publishes there - so apex verification needs a vendor prefix
  # inside the value to say which record belongs to whom. Nothing else
  # publishes at `_langwatch-verification`, so there is nothing to
  # disambiguate it from, and a prefix would only be a longer string to
  # mistype. One label for every organization, never a per-organization one:
  # the VALUE is the secret, and a per-organization label would put a
  # customer's identifier in their public DNS.
  #
  # The administrator is shown the type, the whole name and the label
  # separately, because DNS control panels are split on which name they want
  # and an administrator who guesses wrong publishes at
  # `_langwatch-verification.acme.com.acme.com` and is told it is missing.
  #
  # THREE OUTCOMES, NOT TWO. A lookup answers that the record is there, that
  # it is not there, or that we could not find out. The third is not the
  # second: a SERVFAIL or a timeout says nothing about the customer's DNS, so
  # reporting it as "not published" sends somebody to argue with their DNS
  # team about a record they published correctly an hour ago. It has its own
  # code, `sso_domain_lookup_failed`, and its own words.
  #
  # THE LEDGER IS NEVER TOUCHED ON A FAILURE. The lookup runs before the
  # command, always. An absent record and a failed lookup both return
  # without the aggregate being commanded at all, so no history records an
  # attempt that proved nothing.
  #
  # RE-PROOF IS CONTINUOUS (ADR-123). A published record is only evidence
  # while it is published, so it is read again a few times a day for every
  # domain a record proved. What that produces is a state ON THE EVIDENCE,
  # never on the connection:
  #
  #     VERIFIED  --record absent-->  WAVERING  --still absent after 48h-->  LAPSED
  #        ^                             |                                     |
  #        +-------- record published again <----------------------------------+
  #
  # `SSO_DNS_REPROOF_GRACE_MS` is that window: forty-eight hours. It is long
  # enough to survive a DNS migration done over a weekend and short enough
  # that a domain somebody else now owns cannot quietly admit strangers for a
  # week.
  #
  # ONLY `absent` MOVES ANYTHING. The three-outcome lookup above is why this
  # is safe: `unreachable` has no command at all, so a resolver of ours
  # having a bad hour can neither start a waver nor push one toward a lapse.
  # An outage of ours never spends a customer's grace.
  #
  # A CHECK THAT CHANGES NOTHING STATES NOTHING. Three sweeps a day over a
  # healthy connection write exactly zero events, forever. Only a transition
  # is a fact.
  #
  # WHAT A LAPSE ACTUALLY DOES is narrow, and the narrowness is the decision:
  # the domain stops vouching for somebody NEW — no account provisioned on a
  # first sign-in, no walking in by domain — and nothing else. The connection
  # stays ACTIVE, routing is untouched, and every person already there signs
  # in exactly as before. Wavering changes no behaviour at all; it only
  # alerts. Publishing the record again restores everything with nothing to
  # redo.
  #
  # ONLY RECORDS ARE RE-READ. An attested domain, a licence-proved one and a
  # grandfathered one have no TXT record to be missing, so none of them is
  # ever asked about — and neither is a domain proved before we began keeping
  # the ceremony's hash, because a re-read that cannot compare a value is not
  # evidence of anything.
  #
  # THE RECORD IS THE DECISION. A hosted claim no longer waits for a
  # LangWatch operator to approve it. The published record IS the ownership
  # evidence - it is the strongest thing anybody could hand us, and a person
  # re-reading it added a queue and no safety - so the claim is decided by
  # the proof landing, on a third authority named `dns-proof`. The approval
  # is stated by the same command that states the proof, in that order, so
  # the history can never say a domain was approved before anybody proved it.
  # No operator command appears in an uncontested history at all.
  #
  # WHAT STILL REACHES A PERSON. Exactly one thing: a claim on a domain
  # another organization has already proved. That is a dispute between two
  # customers, it cannot be settled by a DNS record, and it is the only
  # entry the operator queue lists.
  #
  # WHAT IS REFUSED BEFORE ANY OF THAT. A domain nobody could own alone - a
  # consumer mail provider, or a public suffix with no company behind it -
  # is refused at the claim, by name, on every tier. And claims are counted
  # per connection over a window, so enumerating domains costs an attacker
  # the same refusal every time.

  Background:
    Given "acme" is on the hosted service and opted in to setting single
      sign-on up itself
    And "ana" administers "acme" and holds "sso:manage"

  # ── The record a customer is asked for ─────────────────────────────────

  @unit
  Scenario: The record names itself completely, so nothing has to be guessed
    Given "acme"'s claim on "acme.com" is approved
    When "ana" asks for the record to publish
    Then she is given the type, the whole name and the label without her domain
    And the whole name is the label followed by "acme.com"
    And the value is the token, with no prefix, because the label is ours alone

  @integration
  Scenario: The value is shown when it is minted and never read back afterwards
    Given "ana" was given a record to publish for "acme.com"
    When she opens single sign-on setup again
    Then the type and the name are still on screen
    And the value is not, and she is told to ask for a fresh record if she lost it

  # ── The three outcomes ─────────────────────────────────────────────────

  @integration
  Scenario: The record is read before the domain is proved
    Given "ana" published the record she was given on "acme.com"
    When she asks LangWatch to check
    Then the record is looked up first and the domain is proved second
    And the proved fact names the published record as what proved it

  @integration
  Scenario: A record that is not published yet is not a failed proof
    Given the record for "acme.com" has not been published
    When "ana" asks LangWatch to check
    Then it is refused with the code "sso_domain_proof_not_found"
    And no fact is recorded, so the ceremony is exactly where it was
    And the words say to publish it and check again

  @integration
  Scenario: A lookup that could not happen says so, and blames nobody
    Given looking "acme.com" up fails rather than answering
    When "ana" asks LangWatch to check
    Then it is refused with the code "sso_domain_lookup_failed", not with "sso_domain_proof_not_found"
    And no fact is recorded
    And the words say to try again, and do not tell her to change her DNS

  @unit @unimplemented
  Scenario: A name with nothing on it and a resolver that will not answer are told apart
    When the lookup is answered that the name does not exist, or has no such record
    Then that is "nothing is published there"
    And when it fails any other way, that is "we could not find out"
    And neither answer is ever the other

  @integration
  Scenario: Records published by other vendors on the same domain are not our token
    Given several records are published at the verification name
    When LangWatch looks for its own
    Then it proves the domain only if one of them is the token it minted
    And comparing them leaks nothing about how nearly a value matched

  # ── The file channel ───────────────────────────────────────────────────
  # The same minted token, satisfiable a second way: served as the entire
  # body of a plain-text file at the well-known https path. For the customer
  # whose DNS is a ticket away but whose web server is not. One ceremony,
  # one token, two channels — and the verified fact records which channel
  # actually proved it, so the re-proof sweep re-reads the evidence where it
  # lives.

  @integration
  Scenario: The administrator is offered the file channel beside the record
    Given "acme"'s claim on "acme.com" is approved
    When "ana" asks for the record to publish
    Then she is also given the well-known path and the https address to serve
      the same value at

  @integration
  Scenario: Serving the file proves the domain through the same ceremony
    Given "ana" serves the value she was given at the well-known address on "acme.com"
    When she asks LangWatch to check for the file
    Then the file is fetched from exactly the address she was shown
    And the domain is proved, and the claim decided, by that one act
    And the proved fact names the served file as what proved it

  @integration
  Scenario: A file that is not served yet is not a failed proof
    Given nothing is served at the well-known address on "acme.com"
    When "ana" asks LangWatch to check for the file
    Then it is refused with the code "sso_domain_file_not_found"
    And no fact is recorded, and the record channel is exactly where it was
    And the words say to serve the file and check again

  @integration
  Scenario: A fetch that could not happen says so, and blames nobody
    Given fetching the file from "acme.com" fails rather than answering
    When "ana" asks LangWatch to check for the file
    Then it is refused with the code "sso_domain_fetch_failed", not with "sso_domain_file_not_found"
    And no fact is recorded
    And the words say to try again, and do not tell her to re-deploy the file

  @unit @unimplemented
  Scenario: A token read off https proves nothing
    Given "acme.com" redirects the well-known address onto plain http
    When LangWatch fetches the file
    Then the answer is "we could not read it", never a proof
    And a clean not-found stays the one answer that means the file is missing

  @integration
  Scenario: One token satisfies either channel
    Given "ana" was given one value for "acme.com"
    When she publishes it as the record instead of serving the file
    Then the record check proves the domain
    And the proved fact names the published record, not the file

  # ── Expiry and re-proof ────────────────────────────────────────────────

  @integration
  Scenario: A ceremony that expired is re-proved through the same check
    Given the record "ana" published passed its expiry before she checked
    When she asks for a fresh record, publishes it, and checks again
    Then the domain is proved
    And her approved claim was never re-decided, and nothing went back into the queue

  @unit
  Scenario: Nothing schedules a re-check, and an expiry never un-proves a domain
    Given "acme.com" was proved a year ago
    When the ceremony's expiry passes
    Then "acme.com" stays proved
    And a domain stops routing sign-ins only when somebody suspends or tears
      the connection down

  # ── The record decides the claim ───────────────────────────────────────

  @integration
  Scenario: A published record decides the claim, with nobody at LangWatch in the loop
    Given "ana" claimed "acme.com" and published the record she was given
    When she asks LangWatch to check
    Then the claim is approved and the domain is proved by that one act
    And the approval names "dns-proof" as what authorized it
    And no operator command appears anywhere in the connection's history

  @unit
  Scenario: The approval is stated after the proof, never before it
    Given "ana"'s claim on "acme.com" has not been proved yet
    When the connection's history is read
    Then it carries the claim and the record that was asked for
    And it carries no approval, because nothing has proved the domain

  @unit
  Scenario: Claiming the record's authority without the record proves nothing
    Given "ana"'s claim on "acme.com" is waiting and no record is published
    When anybody commands the approval on the authority of a published record
    Then it is refused with the code "sso_connection_invalid_transition"
    And no fact is recorded

  @unit
  Scenario: A licence-bound ceremony cannot stand in for a decision
    Given "ana"'s claim on "acme.com" is waiting
    When a licence-bound ceremony is asked for on that claim
    Then it is refused with the code "sso_connection_invalid_transition"
    And only a published record may decide a claim nobody has decided

  # ── The one thing that still reaches a person ──────────────────────────

  @integration
  Scenario: A claim on a domain another organization proved waits for a person
    Given another organization has already proved "acme.com"
    When "ana" claims "acme.com"
    Then the claim is not decided by any record she could publish
    And she is told it is being looked at, and nothing about who holds the domain
    And it is the operator queue's entry

  @unit
  Scenario: The operator queue lists disputes and nothing else
    Given one claim is waiting for its own record and one is disputed
    When the queue is opened
    Then only the disputed claim is listed
    And the uncontested one is the customer's own to finish

  @integration
  Scenario: An operator still decides a disputed claim, either way
    Given "acme"'s claim on "acme.com" is disputed and waiting
    When a LangWatch operator approves it, or rejects it with a note
    Then the decision is recorded as the operator's, and the queue entry is gone
    And a rejected domain may be claimed again

  # ── Domains nobody may claim, and claims nobody may repeat ─────────────

  @unit
  Scenario: A consumer mail domain cannot be claimed on any tier
    When "gmail.com" is claimed, by an administrator or by an operator
    Then it is refused with the code "sso_domain_not_eligible"
    And no fact is recorded, so nothing about the connection changed

  @unit
  Scenario: A public suffix with no company behind it cannot be claimed either
    When "com" or "co.uk" is claimed
    Then it is refused with the code "sso_domain_not_eligible"
    And the words say to claim the company domain, and list no deny-list

  @integration
  Scenario: Claiming domain after domain is stopped by name
    Given "ana" has claimed as many domains in an hour as the window allows
    When she claims one more
    Then it is refused with the code "sso_domain_claim_throttled"
    And she is told how long is left before she may claim again
    And the domains she already claimed are untouched

  # ── The record is read again, and again ────────────────────────────────

  @integration
  Scenario: A record that has gone missing starts a clock and changes nothing else
    Given "acme.com" was proved by a record "ana" published
    When a re-check finds no matching record on the domain
    Then the proof on "acme.com" is wavering, and the deadline it was given is recorded
    And the connection is exactly as active as it was
    And "acme.com" still lets a new colleague be provisioned, because nothing has lapsed

  @unit
  Scenario: A lookup that could not be answered starts nothing and advances nothing
    Given "acme.com" is proved, and a second domain has been wavering for two days
    When both lookups fail rather than answering
    Then no fact is recorded for either
    And the wavering one has not lapsed, because our resolver does not spend a customer's grace

  @unit
  Scenario: A re-check that finds everything where it was records nothing
    Given "acme.com" is proved and its record is published
    When the sweep reads it three times a day for a week
    Then the connection's history is exactly as long as it was

  @integration
  Scenario: Forty-eight hours of continued absence is a lapse
    Given the record for "acme.com" has been missing since a re-check two days ago
    When a re-check past the deadline finds it still missing
    Then the proof on "acme.com" has lapsed
    And the fact says how long the record had been missing

  @integration
  Scenario: A lapse stops new people and stops nobody who is already here
    Given the proof on "acme.com" has lapsed
    When somebody with an "acme.com" address signs in for the first time
    Then no account is provisioned for them
    And joining "acme" automatically by that domain is refused
    And every existing member signs in exactly as before, because the connection is untouched

  @integration
  Scenario: Publishing the record again restores the domain with nothing to redo
    Given the proof on "acme.com" has lapsed
    When a re-check finds the record published again
    Then the proof on "acme.com" is verified once more
    And no claim was re-decided, no fresh token was minted, and nothing went into a queue

  @unit
  Scenario: A domain no published record ever proved is never doubted by DNS
    Given "acme.com" was attested by a LangWatch operator and "beta.example" was proved by a licence
    When anything tries to record a missing record against either
    Then it is refused with the code "sso_connection_invalid_transition"
    And neither domain can be lapsed by an answer about somebody else's kind of evidence

  @integration
  Scenario: The administrators are told when the record goes, and again when it is too late
    Given "ana" administers "acme" and the record for "acme.com" goes missing
    When the sweep notices
    Then she is emailed what to publish, where it goes, and the deadline
    And the mail carries no token value, because we keep only its fingerprint
    And a second mail at the deadline says what stopped and says existing members are unaffected

  @integration
  Scenario: A domain the file proved is re-read at its file, not at DNS
    Given "acme.com" was proved by serving the verification file
    When the sweep re-reads it and the file is still served
    Then the file was fetched from its well-known address and DNS was never asked
    And the connection's history is exactly as long as it was

  @integration
  Scenario: A file that has gone missing starts the same clock a missing record does
    Given "acme.com" was proved by serving the verification file
    When the sweep finds the well-known address answering without our token
    Then the proof on "acme.com" is wavering, with the same deadline a missing record earns

  # ── Taking a domain back out ───────────────────────────────────────────

  @integration
  Scenario: A domain is taken back out of the connection
    Given "ana" claimed a domain she no longer wants, proved or not yet
    When she removes it from the setup page
    Then the domain is gone from the connection — claim, approval, verification and pending ceremony with it
    And the connection's state falls back to whatever its remaining domains have earned
    And the history keeps every step the domain took

  @integration
  Scenario: A verified domain cannot be removed from a connection that decides sign-in
    Given "acme.com" is verified on an ACTIVE connection
    When "ana" tries to remove the domain
    Then it is refused with the code "sso_connection_invalid_transition"
    And the way to stop routing it is removing the connection itself, which is graced and strand-checked

  # ── Adding a domain while the connection is live ───────────────────────

  @unit
  Scenario: Adding a domain never takes a live connection off the air
    Given "acme.com" is proved on an ACTIVE connection and people sign in through it
    When "ana" adds "acme.co.uk" and it moves through claim, approval and proof
    Then the connection stays ACTIVE at every step, and sign-in on "acme.com" is never interrupted
    And only activating, suspending or tearing down moves the connection's own state

  # ── Somebody else got there first ──────────────────────────────────────

  @integration
  Scenario: A domain another organization proved while this one waited is refused at the check
    Given "ana" was given a record for "acme.com"
    And another organization's connection proved "acme.com" and went live while she published it
    When "ana" asks LangWatch to check
    Then it is refused with the code "sso_connection_domain_taken"
    And the refusal names neither the other organization nor anybody in it
    And "acme.com" is not proved for "acme"

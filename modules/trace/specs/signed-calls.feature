# Decisions: dev/docs/adr/201-braids-show-matching-spans-in-another-projects-traces.md
# (ADR-201) section 4. The keys themselves: modules/api-key/specs/signing-keys.feature.
#
# How a signed call travels: the calling project's SDK signs the baggage entries it names
# with one of its signing keys, over the trace id; the called project's SDK copies those
# entries and the signature onto its spans; ingest checks the signature and marks each
# signed entry verified under langwatch.reserved.verified.<entry>.
#
# A signature covers the trace, not one hop: it travels down the whole call chain, and
# never into another trace. Verified("k") means "the reader signed k for this trace".
#
# Admission is bound at the record-span command with an honest key directory double; key
# rotation, revocation timing and counting are the API key module's own (signing-keys.feature).
# Scenarios still @unimplemented carry the level their binding is expected at.

@trace @braids @ingestion
Feature: Signed calls
  As an admin who braids spans on a tag the calling project sets
  I want the platform to check that the calling project really set it
  So that no call outside the calling project's own call chain can pass as one of its calls

  Background:
    Given plain projects "orchestrator" and "specialists" in one Enterprise organisation
    And "orchestrator" holds a signing key

  Rule: Ingest marks an entry verified only when its signature checks out

    @unit
    Scenario: A span carrying a valid signature is marked verified
      Given "orchestrator" signed the entry orchestrator "web" for a call into "specialists"
      When "specialists" sends a span carrying the entry and the signature
      Then the stored span marks orchestrator as verified by "orchestrator"

    @unit
    Scenario: A span whose signature does not check out is stored unmarked and counted
      Given a span carrying the entry orchestrator "web" and a signature that does not match it
      When "specialists" sends the span
      Then the span is stored without a verified mark
      And the failure is counted against the key the signature named

    @unit
    Scenario: A signature made in one trace does not verify in another
      Given a valid signature taken from a call in one trace
      When a span in a different trace carries the same entry and signature
      Then the span is stored without a verified mark

    @unit
    Scenario: A signed entry stays verified down the call chain within its trace
      Given "orchestrator" signed the entry orchestrator "web" for a call into "specialists"
      And "specialists" called a third project "search" within the same trace, passing the baggage on
      When "search" sends a span carrying the entry and the signature
      Then the stored span marks orchestrator as verified by "orchestrator"

    @unit
    Scenario: A signed entry with a changed value does not verify
      Given "orchestrator" signed the entry orchestrator "web"
      When a span carries the signature with the entry changed to orchestrator "app"
      Then the span is stored without a verified mark

    @unit
    Scenario: A signed entry sent twice, or shadowed by a nested value, does not verify
      Given "orchestrator" signed the entry orchestrator "web"
      When a span carries the signature with orchestrator sent twice, "web" then "admin", or with a nested value stored under the same key
      Then the span is stored without a verified mark
      And the signature is checked against the value the span is stored with, never another

    @unit
    Scenario: A signed entry that admission redacts, rewrites or drops keeps no verified mark
      Given "orchestrator" signed the entry metadata.user_id "ana@example.com" for a call into "specialists"
      When PII redaction, an enrichment or the content drop changes or removes the entry before the span is stored
      Then the span is stored without a verified mark for metadata.user_id
      And an entry admission left exactly as signed keeps its mark

    @unit
    Scenario: A signed entry the store previews or canonicalises keeps no verified mark
      Given a span admitted with entries marked verified
      When the projection previews an entry too large to keep whole, or canonicalisation moves one to another key
      Then the stored span keeps no verified mark for that entry
      And a mark naming an entry the stored span does not carry is never stored
      And an entry stored exactly as admitted keeps its mark

    @unit
    Scenario: A client cannot send its own verified mark
      When a span arrives carrying an attribute under langwatch.reserved.verified
      Then the attribute is removed before the span is stored
      And the verified prefix is never on the list of reserved attributes clients may send

    @unit
    Scenario: A signing key is only looked up inside the span's own organisation
      Given a signature made with a key of a project in another organisation
      When "specialists" sends a span carrying it
      Then the span is stored without a verified mark

    @unit
    Scenario: A key lookup that cannot run leaves the span unverified, not refused
      Given the signing key lookup is unavailable
      When "specialists" sends a span carrying a valid signature
      Then the span is stored without a verified mark
      And ingest does not refuse it

  Rule: Rotated and revoked keys

    @unit
    Scenario: A rotated key keeps verifying for seven days
      Given "orchestrator" rotated its signing key
      When a span signed with the old key arrives within seven days of the rotation
      Then it is marked verified
      And one signed with the old key after seven days is not

    @unit
    Scenario: A revoked key stops verifying within a minute
      Given "orchestrator" revoked its signing key
      When a span signed with that key arrives a minute later
      Then it is stored without a verified mark

  Rule: Verified() in a braid's condition means the reader made the call

    @integration
    Scenario: Verified matches only a mark made with a key of the braid's reader
      Given a braid from "specialists" into "orchestrator" with the condition Verified("orchestrator")
      And a "specialists" span whose orchestrator entry was verified with a key of a third project
      When the trace is read for "orchestrator"
      Then the span is not braided

    @integration
    Scenario: Verified never matches a mark whose entry the span does not carry
      Given a braid from "specialists" into "orchestrator" with the condition Verified("orchestrator")
      And a stored "specialists" span carrying a mark naming "orchestrator" but no orchestrator entry
      When the trace is read for "orchestrator"
      Then the span is not braided

  Rule: The SDK signs on the calling side and copies on the called side

    @unit
    Scenario Outline: The <language> SDK signs the named entries and copies them onto spans
      Given the calling service uses the <language> SDK with a signing key and the entry orchestrator "web"
      And the called service uses the <language> SDK copying the entry orchestrator
      When the calling service calls the called service
      Then every span the called service records carries the entry and its signature
      And ingest marks the entry verified

      Examples:
        | language   |
        | TypeScript |
        | Python     |
        | Go         |

# Decisions: dev/docs/adr/183-braids-show-matching-spans-in-another-projects-traces.md
# (ADR-183) section 4. The keys themselves: modules/api-key/specs/signing-keys.feature.
#
# How a signed call travels: the calling project's SDK signs the baggage entries it names
# with one of its signing keys, over the trace id; the called project's SDK copies those
# entries and the signature onto its spans; ingest checks the signature and marks each
# signed entry verified under langwatch.reserved.verified.<entry>.
#
# A signature covers the trace, not one hop: it travels down the whole call chain, and
# never into another trace. Verified("k") means "the reader signed k for this trace".
#
# EVERY SCENARIO IS @unimplemented: none of this is built. Each carries the level its
# binding is expected at, and the pull request that builds it binds it.

@trace @braids @ingestion
Feature: Signed calls
  As an admin who braids spans on a tag the calling project sets
  I want the platform to check that the calling project really set it
  So that no call outside the calling project's own call chain can pass as one of its calls

  Background:
    Given plain projects "orchestrator" and "specialists" in one Enterprise organisation
    And "orchestrator" holds a signing key

  Rule: Ingest marks an entry verified only when its signature checks out

    @integration @unimplemented
    Scenario: A span carrying a valid signature is marked verified
      Given "orchestrator" signed the entry orchestrator "web" for a call into "specialists"
      When "specialists" sends a span carrying the entry and the signature
      Then the stored span marks orchestrator as verified by "orchestrator"

    @integration @unimplemented
    Scenario: A span whose signature does not check out is stored unmarked and counted
      Given a span carrying the entry orchestrator "web" and a signature that does not match it
      When "specialists" sends the span
      Then the span is stored without a verified mark
      And the failure is counted against the key the signature named

    @unit @unimplemented
    Scenario: A signature made in one trace does not verify in another
      Given a valid signature taken from a call in one trace
      When a span in a different trace carries the same entry and signature
      Then the span is stored without a verified mark

    @integration @unimplemented
    Scenario: A signed entry stays verified down the call chain within its trace
      Given "orchestrator" signed the entry orchestrator "web" for a call into "specialists"
      And "specialists" called a third project "search" within the same trace, passing the baggage on
      When "search" sends a span carrying the entry and the signature
      Then the stored span marks orchestrator as verified by "orchestrator"

    @unit @unimplemented
    Scenario: A signed entry with a changed value does not verify
      Given "orchestrator" signed the entry orchestrator "web"
      When a span carries the signature with the entry changed to orchestrator "app"
      Then the span is stored without a verified mark

    @unit @unimplemented
    Scenario: A client cannot send its own verified mark
      When a span arrives carrying an attribute under langwatch.reserved.verified
      Then the attribute is removed before the span is stored
      And the verified prefix is never on the list of reserved attributes clients may send

    @unit @unimplemented
    Scenario: A signing key is only looked up inside the span's own organisation
      Given a signature made with a key of a project in another organisation
      When "specialists" sends a span carrying it
      Then the span is stored without a verified mark

    @unit @unimplemented
    Scenario: A key lookup that cannot run leaves the span unverified, not refused
      Given the signing key lookup is unavailable
      When "specialists" sends a span carrying a valid signature
      Then the span is stored without a verified mark
      And ingest does not refuse it

  Rule: Rotated and revoked keys

    @integration @unimplemented
    Scenario: A rotated key keeps verifying for seven days
      Given "orchestrator" rotated its signing key
      When a span signed with the old key arrives within seven days of the rotation
      Then it is marked verified
      And one signed with the old key after seven days is not

    @integration @unimplemented
    Scenario: A revoked key stops verifying within a minute
      Given "orchestrator" revoked its signing key
      When a span signed with that key arrives a minute later
      Then it is stored without a verified mark

  Rule: Verified() in a braid's condition means the reader made the call

    @unit @unimplemented
    Scenario: Verified matches only a mark made with a key of the braid's reader
      Given a braid from "specialists" into "orchestrator" with the condition Verified("orchestrator")
      And a "specialists" span whose orchestrator entry was verified with a key of a third project
      When the trace is read for "orchestrator"
      Then the span is not braided

  Rule: The SDK signs on the calling side and copies on the called side

    @integration @unimplemented
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

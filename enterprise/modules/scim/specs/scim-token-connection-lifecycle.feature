Feature: A directory token lives exactly as long as the connection it names
  As an organization administrator wiring a directory at LangWatch
  I need a provisioning token to stop working when the connection it names is
  taken away, and to keep working while that connection is only paused
  So that a removed connection cannot keep provisioning into my organization

  # Minting, hashing, entitlement and revocation scenarios live in scim.feature.

  Background:
    Given an organization "acme" whose administrator is issuing a provisioning token

  Rule: a token lives exactly as long as the connection it names

    # WHOSE JOB THE RETIREMENT IS. Identity states the connection lifecycle
    # and counts no token of ours, so the ending is this module's to perform:
    # the first request a retired connection's credential makes is refused,
    # and every token issued against that connection is retired with it,
    # rather than each push being told its credential is unknown.

    @unit
    Scenario: A token whose connection was taken away is refused and retired
      Given a token issued against a connection the organization no longer holds
      When the directory presents it
      Then the credential is refused
      And every token issued against that connection is retired with it

    @unit
    Scenario: A suspended connection keeps the tokens issued against it
      Given a connection an operator has suspended
      When the directory presents a token issued against it
      Then it still provisions, because a suspended connection is paused
      rather than gone

    @integration
    Scenario: A token that names no connection is left exactly as it was
      Given a token issued before connections existed
      When the directory presents it
      Then no connection is asked about
      And the organization-wide reach it was sold with stands

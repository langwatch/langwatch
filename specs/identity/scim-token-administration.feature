Feature: Issuing, reading and revoking a directory token
  As an organization administrator wiring a directory at LangWatch
  I need a provisioning token to name the connection it syncs, to exist only
  as a hash once I have copied it, and to be checked against our plan every
  time it is used
  So that a token cannot outlive the entitlement that justified it, cannot be
  read back out of our database, and cannot be aimed at somebody else's
  organization

  # WHICH CONNECTION A TOKEN IS FOR. A directory token provisions into exactly
  # one single sign-on connection, so the mint has to know which. The list of
  # candidates is the identity module's - this module keeps no register of
  # connections of its own - and what the chooser does with it depends on how
  # many are live.
  #
  # Which connections are OFFERED, and what a retired one reads as, is the
  # authentication page's own rule and lives in
  # specs/identity/organization-authentication-settings.feature. This file is
  # about what the mint does with the answer.
  #
  # ENTITLEMENT IS A USE-TIME QUESTION. Checking the plan only at the mint
  # left every token issued under an expired trial working indefinitely. It is
  # asked on every exercise, and an invalid credential, a lapsed plan and an
  # unknown token are three different answers - collapsing them sent an
  # administrator looking for a typo when the real fact was a lapsed plan.

  Background:
    Given an organization "acme" whose administrator is issuing a provisioning token

  Rule: the mint names the connection, asking only when it must

    @integration
    Scenario: The connections offered are the ones the identity module holds
      When the chooser is filled
      Then the connections are the ones identity holds, lifecycle state and all

    @integration
    Scenario: A single live connection is taken without asking
      Given "acme" has exactly one live connection
      When the token is minted
      Then it is bound to that connection without anybody being asked

    @integration
    Scenario: Several live connections hold the mint until one is named
      Given "acme" has more than one live connection
      When the administrator goes to mint a token
      Then the mint waits until one of them is named, rather than guessing

    @integration
    Scenario: Two connections at the same provider are told apart by their protocol
      Given "acme" has two connections at the same provider
      When they are offered
      Then each is named by the protocol identity recorded for it
      And a connection with no protocol recorded is left named as it is

  Rule: the value is handed over once and never stored

    @unit
    Scenario: Token values are stored only as hashes
      When a token is minted
      Then only a hash of it is stored
      And reading the tokens back answers summaries, never values

  Rule: entitlement and ownership are checked every time

    @unit
    Scenario: Entitlement is checked whenever a token is exercised
      When a token is exercised
      Then an invalid credential, a lapsed plan and an unknown token are told apart

    @unit
    Scenario: Revocation is organization scoped
      When an organization revokes a token that belongs to another organization
      Then it is reported as not found rather than revoked

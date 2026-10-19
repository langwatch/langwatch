@unit
Feature: Trusted single sign-on origins
  The installation fetches discovery documents and sends assertions only to
  identity providers a customer registered, plus whatever the deployment
  trusts outright. An unregistered issuer is refused by name, never fetched.

  Rule: Registration is what makes an issuer reachable

    @unit
    Scenario: An issuer a customer registered is one this installation may fetch from
      Given an organization registered a connection whose issuer is "https://idp.acme.test"
      When a sign-in names that connection
      Then the installation may fetch from "https://idp.acme.test"
      And the sign-in proceeds to the provider's authorization address

    @unit
    Scenario: An issuer nobody registered is refused by name
      Given no connection registered "https://idp.stranger.test"
      When a sign-in resolves a provider at "https://idp.stranger.test"
      Then the sign-in is refused with the code "discovery_untrusted_origin"
      And nothing is fetched from it

  Rule: Deployment trust is a declared fact, never a default

    @unit
    Scenario: The worktree simulator is trusted outside production only
      Given the deployment declares its identity-provider simulator address
      And the process does not run in production
      When a sign-in resolves a provider at the simulator
      Then the simulator is trusted
      But in production the same address is refused by name

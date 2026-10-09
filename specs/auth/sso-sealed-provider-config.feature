@unit
Feature: Sealed single sign-on provider configuration
  Identity stores each connection's dialing document sealed. The sign-in engine
  reads that document on more than one storage call, and every one of them
  hands it the document opened, so a sealed row signs people in.

  Rule: Every provider row the engine is handed is opened

    # The callback locks the provider by updating it and compares the returned
    # row with the one it read. A sealed document there refused the sign-in
    # with 400 "Cannot update OIDC config".
    @unit @regression
    Scenario: The row the engine locks carries the opened dialing document
      Given an organization registered an OIDC connection
      And its dialing document is stored sealed
      When the sign-in callback locks the provider row
      Then the row it is handed carries the opened dialing document
      And the stored document is still sealed

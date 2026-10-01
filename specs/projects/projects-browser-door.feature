@unit
Feature: The project.* browser namespace is served by the application the composition builds
  As somebody signed in to a project
  I want the project screens to answer
  So that I can change settings, archive a project and ask for topics

  # The sibling of specs/projects/projects-management-door.feature, for the
  # tRPC door rather than the REST one, and for the same defect: the namespace
  # is declared against a witness interface (`ProjectBrowserApi`) that nothing
  # in the composition implements. Boot hands a door the operations-only proxy
  # over its module's application, so a member the door names and the
  # application does not serve is not caught at the seam — it is a TypeError on
  # the first access, which the boundary degrades to a generic "unknown".
  # apidiff never saw this family, because apidiff probes REST only.
  #
  # These scenarios are bound to tests that build the REAL ProjectApp over its
  # own repository interface and reach it through that same proxy.
  #
  # The scenarios below drive each procedure through the INSTALLED module
  # on the production tRPC runtime (door audit 2026-09-24). Each failed first
  # with "exposes operations only: <member> is not callable".

  Scenario: creating a project answers with the new project's slug
    Given the project module installed over memory repositories
    When somebody creates a project into a new team
    Then they are answered with the slug of the project created
    And Langy's virtual key is provisioned on a best-effort basis

  Scenario: the redaction status reads the caller's own protections
    Given the project module installed over memory repositories
    When somebody reads the project's field redaction status
    Then the answer is resolved from the caller's own captured-content protections

  Scenario: a Langy key that cannot be minted does not fail the project's creation
    Given the gateway key cannot be minted for a new project
    When Langy is asked to provision the project's virtual key
    Then the failure is reported and the request answers normally

  # Moves to the onboarding module, its own lane (Alex, 2026-09-24).
  @unimplemented
  Scenario: the setup checklist answers for the project
    Given the project module installed over memory repositories
    When somebody reads the project's setup checklist
    Then they are answered with the project's setup counts

  Scenario: stored-object credentials are written through the deployment's cipher
    Given somebody signed in to a project
    When they save stored-object credentials on the settings form
    Then each credential is stored enciphered by the deployment's own cipher

  Scenario: flipping trace sharing asks the caller's own standing
    Given somebody who may change a project but not manage it
    When they flip trace sharing on the settings form
    Then the request is refused
    And the project's trace sharing is left as it was

  Scenario: archiving another project is probed on that project
    Given somebody signed in to one project archiving a different one
    When the request is served
    Then their standing is asked about the project being archived
    And the project is archived only when that answer permits it

  Scenario: a clustering request that fails is reported, not raised
    Given a deployment whose clustering scheduler cannot be reached
    When somebody asks for topic clustering
    Then the failure is reported for the project it happened on
    And the caller is answered with an unknown failure rather than a named one

  Scenario: A project manager revokes the legacy project key and is shown no key
    Given a project with a legacy project key
    And somebody who is an administrator of the project
    When they ask whether the project still has a legacy key
    Then the answer is that it does, and carries no part of the key
    When they revoke the legacy key
    Then the answer is that it was revoked, and carries no key
    And the old key no longer resolves to the project
    And asking again says the project has no legacy key
    And the revocation is recorded in the audit trail with who did it

  Scenario: Revoking the legacy project key again succeeds and changes nothing a caller can use
    Given a project whose legacy key was already revoked
    When an administrator revokes the legacy key again
    Then the answer is that it was revoked
    And the project still has no legacy key

  Scenario: A member who is not an admin cannot revoke the project key
    Given somebody who may change a project but not manage it
    When they revoke the legacy project key
    Then the request is refused
    And the legacy key still resolves to the project

  Scenario: A member who is not an admin cannot read the legacy key status
    Given somebody who may change a project but not manage it
    When they ask whether the project still has a legacy key
    Then the request is refused

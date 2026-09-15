@unit
Feature: The project.* browser namespace is served by the application the composition builds
  As somebody signed in to a project
  I want the project screens to answer
  So that I can read the base key, change settings, archive a project and ask for topics

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
  # Three members of the witness are NOT served by the application and are not
  # the application's to serve: captured-content protections belong to the
  # trace module, the Langy virtual key to the gateway, and the audit record to
  # the audit-log module, and `apps/worker` installs this module beside none of
  # them. The first scenario states which members the application answers, so
  # that the list is a fact a test holds rather than a claim in a comment.

  Scenario: a mounted door reaches only members the application serves
    Given the project application as the composition builds it
    When a door reaches it through the feature-API proxy
    Then every member the application serves is callable
    And every member it does not serve refuses by name

  Scenario: the browser door reads the project the composition built
    Given somebody signed in to a project
    When they read the project's base key
    Then the answer carries the project the application's own repository holds

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

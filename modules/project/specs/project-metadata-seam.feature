Feature: The project reads ingestion makes compose without the write graph
  Folding a span reads a project four ways — by id, with its team so a privacy
  policy and a cost scope can be resolved, and through the organization admin
  who should hear about a first trace — and writes one thing, the first-message
  and integrated flags. None of those five reaches a credentials port, an
  organization service, the LWQL key map or the stored-object deleter, all four
  of which the project service requires because creating and archiving a project
  needs them.

  This feature is about those five operations being composable on their own, and
  about the wide service continuing to answer them from the same implementation
  rather than a second copy.

  Rule: The seam composes from a database and nothing else

    @unit
    Scenario: The metadata seam composes from a database alone
      Given a Prisma client and no other collaborator
      When the project metadata seam is composed
      Then it answers the project read and the organization admin resolution

    @unit
    Scenario: A project the seam cannot resolve reports absence, not an admin
      Given a project id that resolves to no row
      When the organization admin is resolved
      Then an empty resolution is answered

    @unit
    Scenario: A failing organization-admin read is reported, not raised
      Given a project read that throws
      When the organization admin is resolved
      Then an empty resolution is answered
      And the failure is reported and captured through diagnostics

  Rule: One implementation, two composition roots

    @unit
    Scenario: The wide service and the seam answer from one implementation
      Given the project service and the metadata seam over the same client
      When both are asked for the same project and the same organization admin
      Then both answer identically

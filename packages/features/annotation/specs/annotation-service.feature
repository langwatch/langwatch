Feature: Annotation service boundary

  Scenario: a process composes one annotation capability
    Given the process builds the PostgreSQL annotation adapter at startup
    When an annotation caller requests a write or projection read
    Then it uses the same contract AnnotationService instance
    And it does not construct a repository for the request

  Scenario: annotation input is validated by the contract
    Given an annotation command has an incomplete anchor
    When the service receives the command
    Then validation fails before persistence is called

  Scenario: a required annotation lookup throws
    Given the requested annotation does not exist in the project
    When the service performs the ordinary lookup
    Then it throws AnnotationNotFoundError

  Scenario: annotation persistence stays private
    Given a PostgreSQL row is returned
    When the annotation repository maps the row
    Then the result conforms to the contract schema
    And generated Prisma types do not cross the package boundary

  Scenario: trace projections receive anchored annotations
    Given a project has comments about a trace and about fields within it
    When the service reads annotations for a trace projection
    Then it returns both comments with their anchor fields

  Scenario: queues and scores remain one future annotation seam
    Given a compatibility route manages queues or score definitions
    When this extraction is used
    Then it remains an application transport seam
    And it does not create a separate queue or score feature package

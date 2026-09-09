Feature: Annotation service boundary

  @integration
  Scenario: reusable annotation browser surfaces stay in the feature web package
    Given a trace surface renders an annotation card or editor
    When the application composes its queries, mutations and trace navigation
    Then the card, editor body, diff and score controls come from annotation-web
    And the application supplies only narrow data and action ports

  Scenario: a process composes one annotation capability
    Given the process selects annotation's Postgres or memory repository factory at startup
    When an annotation caller requests a write or projection read
    Then it uses the same callable AnnotationApi instance
    And it does not construct a repository for the request

  @unit
  Scenario: annotation input is validated by the contract
    Given an annotation command has an incomplete anchor
    When the service receives the command
    Then validation fails before persistence is called

  @unit
  Scenario: a required annotation lookup throws
    Given the requested annotation does not exist in the project
    When the service performs the ordinary lookup
    Then it throws AnnotationNotFoundError

  @unit
  Scenario: a missing project retains its original handled error
    Given ProjectApi throws ProjectNotFoundError for the requested project
    When the annotation app configures a queue in that project
    Then the same error reaches the caller unchanged
    And no queue is created

  @unit
  Scenario: a trace marker failure does not fail a committed annotation mutation
    Given trace marker creation and removal are unavailable
    When a reviewer creates and then deletes an annotation
    Then both annotation mutations succeed
    And the annotation is absent after deletion
    And the marker failures are logged

  Scenario: annotation persistence stays private
    Given a PostgreSQL row is returned
    When the annotation repository maps the row
    Then the result conforms to the contract schema
    And generated Prisma types do not cross the package boundary

  @unit
  Scenario: queue references use their owning services
    Given a queue command names project members and score definitions
    When the annotation app validates the command
    Then project ownership comes from ProjectApi
    And members are read in one OrganizationApi batch
    And invalid project or member references retain the existing 404 or 400 outcome

  Scenario: queue-item writes are atomic
    Given a queue command has traces, queues and users
    When the queue-item service upserts its queue items
    Then all upserts use one database transaction
    And requeueing keeps the existing unique-key and done-state behaviour

  @integration
  Scenario: trace projections receive anchored annotations
    Given a project has comments about a trace and about fields within it
    When the service reads annotations for a trace projection
    Then it returns both comments with their anchor fields

  Scenario: queue transport orchestration remains one annotation seam
    Given a compatibility route manages queues or score definitions
    When this extraction is used
    Then the annotation app owns queue configuration and read orchestration
    And score definitions and queue-item writes use their respective private services
    And it does not create a separate queue or score feature package

  Scenario: transport user projections preserve their legacy shape
    Given an annotation result set names users
    When a tRPC transport returns it
    Then the annotation app loads those users once through UserApi
    And project and queue reads retain full user scalars
    And trace reads retain only id, name and image

  Rule: Every role uses the same annotation app and queue workflow

    @unit
    Scenario: Queue configuration validates references before reserved names
      Given a queue configuration contains a member outside the project organisation
      And its name resolves to a reserved queue slug
      When the queue service configures the queue
      Then the invalid member is rejected before any queue lookup or write

    @unit
    Scenario: Completing an item derives the organisation from its project
      Given a reviewer names a queue item in a project
      When the queue service marks the item done
      Then it resolves the organisation from that project
      And the repository receives that project, organisation and reviewer
      And an unreachable item produces the annotation queue item not-found error

    @unit
    Scenario: Queueing keeps only distinct traces held by the project
      Given the requested trace IDs contain duplicates, blanks and unresolved traces
      When the queue service queues them for validated annotators
      Then only distinct trimmed trace IDs held by that project are written
      And all other supplied IDs count as skipped

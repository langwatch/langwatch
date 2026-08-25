Feature: Annotation service boundary

  Scenario: reusable annotation browser surfaces stay in the feature web package
    Given a trace surface renders an annotation card or editor
    When the application composes its queries, mutations and trace navigation
    Then the card, editor body, diff and score controls come from annotation-web
    And the application supplies only narrow data and action ports

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

  Scenario: queue references use their owning services
    Given a queue command names project members and score definitions
    When the annotation service validates the command
    Then project ownership comes from ProjectService
    And members are read in one OrganizationService batch
    And invalid project or member references retain the existing 404 or 400 outcome

  Scenario: queue-item writes are atomic
    Given a queue command has traces, queues and users
    When the annotation service upserts its queue items
    Then all upserts use one database transaction
    And requeueing keeps the existing unique-key and done-state behaviour

  Scenario: trace projections receive anchored annotations
    Given a project has comments about a trace and about fields within it
    When the service reads annotations for a trace projection
    Then it returns both comments with their anchor fields

  Scenario: queue transport orchestration remains one annotation seam
    Given a compatibility route manages queues or score definitions
    When this extraction is used
    Then queue configuration and read orchestration remain an application transport seam
    And score definitions and queue-item writes use the same AnnotationService
    And it does not create a separate queue or score feature package

  Scenario: transport user projections preserve their legacy shape
    Given an annotation result set names users
    When a tRPC transport returns it
    Then it loads those users once through UserService
    And project and queue reads retain full user scalars
    And trace reads retain only id, name and image

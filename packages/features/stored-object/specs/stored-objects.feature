# See ../adrs/001-package-boundary.md
@unimplemented
Feature: Stored Objects service and API
  As a feature or API client
  I want durable project-scoped byte references
  So that bytes can be stored and delivered without exposing provider details

  @architecture @typecheck
  Scenario: Stored Objects lives in one feature package
    Given Stored Objects is installed
    Then @langwatch/stored-object-contract contains portable schemas, errors and RPC contracts
    And @langwatch/stored-object-server contains the concrete store, service, migration and API registration
    And the feature has no web package or separate object-storage package
    And neither package imports the application

  @architecture @typecheck
  Scenario: Stored Objects adopts the strict feature layout
    Given the Stored Objects implementation is reduced to its approved scope
    And its feature.json declares layoutVersion 0
    Then its contract capability is stored-object.service.ts
    And its server service is services/stored-object.service.ts
    And its store port and Postgres adapter use stores/stored-object.store.ts and stores/postgres/postgres.stored-object.store.ts
    And its public API is api/public/stored-object.api.ts
    And its ClickHouse import is migrations/clickhouse-import.stored-object.migration.ts
    And no composition, registration, lifecycle, or eventing source directory remains

  @architecture @persistence
  Scenario: One Postgres row owns current state
    Given Stored Objects persists operational metadata
    Then StoredObject is its only Postgres domain table
    And the row contains tenant, object, status, owner, provider-relative identity, byte facts and expiry timestamps
    And StoredObjectStore is an abstract class with one concrete Postgres class
    And StoredObjectService is a concrete class
    And no Stored Object event projection, process manager or parallel lifecycle store exists

  @architecture @storage
  Scenario: Stored Objects has one portable storage URI owner
    Given the application composes its existing storage drivers
    Then @langwatch/stored-object-contract owns URI formatting and redaction
    And the existing S3, Azure Blob and local-filesystem drivers remain authoritative
    And application composition owns lazy scheme dispatch
    And validated application configuration retains destination selection and credentials
    And inactive Azure configuration does not block S3 or local-filesystem traffic

  @integration @stored-objects
  Scenario: Internal storage is content addressed
    Given a feature stores bytes through app.storedObjects
    When the same project stores identical bytes again
    Then both calls derive the same stored-object ID from project and SHA-256
    And one available StoredObject row describes the bytes
    And each caller may retain its own presentation metadata

  @integration @public-rpc
  Scenario: A public client creates a direct upload
    Given an authenticated project whose selected storage driver supports direct upload
    When the client calls storedObjects.createUpload with bounded metadata and byte facts
    Then a pending StoredObject row with an expiry is persisted before the response is returned
    And the response contains an opaque upload token and signed provider target
    And provider credentials and relative identity are not returned

  @integration @public-rpc @integrity
  Scenario: A client confirms a direct upload
    Given a client uploaded bytes to its signed target
    When it calls storedObjects.confirmUpload
    Then the service verifies the stored length and SHA-256
    And the same StoredObject row becomes available
    And retrying confirmation returns the same reference
    And absent, expired or mismatched bytes never become available

  @integration @cleanup
  Scenario: Expired pending uploads are cleaned from the same row
    Given a pending upload has passed expiresAt without confirmation
    When the bounded cleanup pass visits it
    Then the service deletes its provider bytes if present
    And the StoredObject row becomes failed
    And retrying cleanup is safe

  @integration @delivery @security
  Scenario: An authorized caller resolves and streams bytes
    Given an available stored object belongs to the authenticated project
    When the caller resolves it or uses its GET or HEAD delivery route
    Then the public RPC authorizes the object's validated audience through the request context
    And metadata comes from Postgres
    And bytes stream through the existing storage adapter
    And the response reveals no provider, credential or filesystem detail
    And an object from another project is not read

  @integration @delete
  Scenario: Deletion immediately revokes delivery
    Given an available stored object
    When its project calls storedObjects.delete
    Then the row becomes deleted before physical cleanup is attempted
    And later delivery is refused
    And failed physical cleanup remains retryable from that same row
    And repeating deletion is safe

  @integration @api @authorization
  Scenario: The public API uses the unified API package
    Given the Stored Objects public API is installed
    Then createUpload and confirmUpload require project:update
    And get requires project:view
    And delete requires project:manage
    And @langwatch/api supplies routing, validation, OpenAPI, telemetry, handled errors and registration
    And rate limiting is declared through the existing endpoint capability

  @integration @trpc
  Scenario: Application tRPC remains separate
    Given the dashboard uses its existing Stored Objects procedure
    When the procedure resolves an object
    Then it delegates to the composed app.storedObjects service
    And it does not expose public upload or migration operations
    And it does not construct a second service

  @integration @delivery @compatibility
  Scenario: Historical id-only delivery resolves the owner without masking degradation
    Given a historical GET or HEAD /api/files/:id URL has no project scope
    When the server-only owner resolver fans out to the configured ClickHouse instances
    Then a healthy matching instance identifies the project before byte authorization
    And a miss across healthy instances remains not found
    And a miss with any failed instance is mapped to the existing 502 response
    And a project-scoped URL does not invoke the cross-tenant resolver

  @integration @migration
  Scenario: The system migration copies legacy ClickHouse rows directly
    Given an organization has stored_objects rows in ClickHouse
    When StoredObjectsMigration runs after being registered with the system migration service
    Then it pages the organization's projects and latest rows
    And it idempotently upserts their existing IDs and storage locations into StoredObject
    And rerunning a completed page creates no duplicate state
    And invalid input parks the tenant with a bounded report
    And Postgres becomes authoritative only after old writers drain and a final pass succeeds

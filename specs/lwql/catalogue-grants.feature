Feature: The LangWatchQL catalogue declares who reads each table and column, resolved per caller

  As a LangWatch operator granting access through roles
  I want every LangWatchQL table and column to name the permissions that read it
  So that a caller reads only what their grants unlock, and a new column is exposed only by decision

  # Every table carries a typed access (registry permissions, allOf or anyOf, never empty) and
  # lists every source column: "inherit", "omit", or a gate with an optional source. The
  # compiler checks the list against the source's generated row type. Authority fails closed;
  # tooling fails open. Machinery: modules/analytics/process/src/rules/lwql-catalogue.rules.ts.

  Rule: The catalogue is complete by construction

    @unit
    Scenario: A table without access does not compile
      Given a catalogue table that declares no access
      Then the analytics process fails its type check

    @unit
    Scenario: An empty or unknown permission list does not compile
      Given a catalogue table whose access lists no permission, or one outside the registry
      Then the analytics process fails its type check

    @unit
    Scenario: A source column with no entry does not compile
      Given a table whose row type has a column the catalogue does not list
      Then the analytics process fails its type check

    @unit
    Scenario: An exposed name the source lacks must name its source
      Given a column entry whose name is not a column of the source table
      When the entry declares no source column
      Then the analytics process fails its type check

    @unit
    Scenario: A column cannot be exposed from an omitted column
      Given a source column marked omit
      When another entry names it as its source
      Then the analytics process fails its type check

    @unit
    Scenario: The row types are regenerated with the manifests
      Given the committed ClickHouse and Prisma manifests
      When their row types are rendered
      Then they equal the committed generated row types
      And no name is both a ClickHouse table and a Prisma model

    @unit
    Scenario: A renamed column reads its declared source
      Given a column entry naming a different source column
      When the view is rendered
      Then the exposed column reads the source column

    @unit
    Scenario: An omitted column is exposed nowhere
      Given a column marked omit
      Then no view, schema entry or database grant names it

    @unit
    Scenario: The database grants are derived from the same catalogue
      When the access model is built
      Then every granted column is an exposed catalogue column and no other

  Rule: A caller reads only what their grants unlock

    @integration
    Scenario: A member without a table's permission is refused by name
      Given a member holding analytics:view but not virtualKeys:view in the project
      When they run "SELECT * FROM analytics.virtual_keys"
      Then the query is refused with TABLE_NOT_ALLOWED
      And availableViews does not list virtual_keys

    @integration
    Scenario: The schema omits a table the caller cannot read
      Given a member holding analytics:view but not virtualKeys:view in the project
      When they read the LangWatchQL schema
      Then no view named virtual_keys is listed

    @integration
    Scenario: allOf needs every permission; anyOf needs one
      Given a table whose access is allOf two permissions and another whose access is anyOf two
      And a member holding only the first permission of each
      When they query both tables
      Then the allOf table is refused with TABLE_NOT_ALLOWED
      And the anyOf table returns rows

    @integration
    Scenario: An organization-tier permission is asked at the organization
      Given a member holding governance:view at their organization
      When they query analytics.governance_kpis in one of its projects
      Then rows are returned

    @integration
    Scenario: An API key is bounded by its own grants and its owner's
      Given a key granted virtualKeys:view whose owner lost it
      When the key queries analytics.virtual_keys
      Then the query is refused with TABLE_NOT_ALLOWED

    @integration
    Scenario: A key spanning projects reads a table only in projects that grant it
      Given an organization key holding prompts:view in project A only
      When it queries analytics.prompts
      Then only project A's rows return

    @unit
    Scenario: A job the project runs for itself resolves the whole catalogue
      Given the project itself as the principal
      When the accessible catalogue is resolved
      Then every table and column of the catalogue is readable

  Rule: Columns follow their own access and content gates

    @integration
    Scenario: A cost column without cost:view is listed unavailable and refused
      Given a member without cost:view
      Then the schema lists the cost column with available false and gate "cost:view"
      And selecting it is refused with GATED_COLUMN at the column's position

    @integration
    Scenario: A content column follows the project's data-privacy policy
      Given a project whose data-privacy policy hides captured input from the member
      When the member selects traces.CapturedInput
      Then the query is refused with GATED_COLUMN at the column's position
      And traces.CapturedOutput stays readable when the policy shows output

  Rule: Authority fails closed

    @integration
    Scenario: A permission check that throws refuses rather than widening
      Given the authz check throws
      When a member runs any statement
      Then the statement is refused with a handled 5xx and no rows

    @integration
    Scenario: A data-privacy failure hides content only
      Given the data-privacy policy cannot be read
      When a member holding every table permission queries traces
      Then CapturedInput and CapturedOutput are listed unavailable
      And every other traces column returns rows

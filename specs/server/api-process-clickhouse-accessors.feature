Feature: The API process routes its three ClickHouse reads by the right id
  As an operator running a LangWatch API deployment
  I want each read to reach the endpoint that holds its rows
  So that a paying organization sees its own usage and an operator can search
  the install's event log

  # WHY THIS EXISTS
  #
  # This process opened ONE ClickHouse connection and published exactly one
  # question against it: "the client for THIS tenant". That was the right
  # default — a caller who can reach the shared endpoint can read one
  # organization's rows on another's — but it left two reads unanswerable, and
  # both were recorded as absences rather than noticed as bugs.
  #
  # The billable-events rollup is scoped by ORGANIZATION. An organization's
  # events span every project it owns, so there is no project to route on, and
  # handing an organization id to the tenant router does not mis-route: the
  # directory behind it looks a project row up, finds none, and raises
  # `UnknownTenantError`. Every organization metered in events therefore read
  # its month's volume as UNKNOWN.
  #
  # The operator's event-log explorer is the opposite shape: it searches
  # `event_log` ACROSS tenants, so it has no id at all until it has found the
  # aggregate. It needs the install's own shared endpoint.
  #
  # Both are answered by the connection this process already holds, so neither
  # opens a second pool. What was missing was two accessors beside the
  # tenant-keyed one, and the routing rule they each keep.

  Background:
    Given an API process that opened its own ClickHouse connection
    And a deployment with a shared endpoint and one organization on its own

  Rule: Each accessor routes by the id it was given, and by no other

    @unit
    Scenario: An organization on its own endpoint is routed there without a tenant lookup
      When the process resolves the client for that organization
      Then it reaches that organization's own endpoint
      And the tenant directory is not consulted, because an organization is not a tenant

    @unit
    Scenario: An organization with no private route reads the shared endpoint
      When the process resolves the client for an organization with no route of its own
      Then it reaches the shared endpoint

    @unit
    Scenario: A project is still routed through the tenant directory
      When the process resolves the client for one of that organization's projects
      Then it reaches the same endpoint the organization does

    @unit
    Scenario: The install's own shared endpoint answers the read that is nobody's tenant
      When the process asks for the shared endpoint
      Then it answers the install's own endpoint

    @unit
    Scenario: The three accessors share one driver per physical endpoint
      When the process resolves a tenant, an organization and the shared endpoint
      Then one driver is opened per endpoint and no accessor opens a pool of its own

  Rule: A deployment with no shared endpoint says so rather than throwing

    @unit
    Scenario: An install holding only private routes reports no shared endpoint
      Given a deployment configured with private routes alone
      When the process asks for the shared endpoint
      Then it answers that there is none
      And the caller decides what to compose, rather than discovering it at the first query

  Rule: An organization metered in events is counted, not reported unknown

    @unit
    Scenario: The month's events are read off the organization-keyed rollup
      Given an organization whose plan meters it in events
      When the usage panel is read
      Then the count comes back as a number
      And the read is issued against `billable_events` scoped by the organization

    @unit
    Scenario: The organization id never reaches the tenant resolver
      Given an organization whose plan meters it in events
      When the usage panel is read
      Then only the organization-keyed accessor is asked
      And the tenant-keyed resolver is not asked at all

    @unit
    Scenario: A deployment with no ClickHouse reads the volume as unknown, not as zero
      Given a process that opened no ClickHouse connection
      When the usage panel is read
      Then the month's volume is reported as unknown
      And it is not reported as zero, which would say the organization sent nothing

  Rule: The operator's event log is searchable where there is an install-wide endpoint

    @integration
    Scenario: The operator searches the event log through the composed explorer
      Given a process holding the install's shared endpoint
      When an operator searches for an aggregate
      Then the search runs against `event_log`
      And the matching aggregates are returned

    @integration
    Scenario: An install with no shared endpoint refuses the search by name
      Given a process holding no shared endpoint
      When an operator searches for an aggregate
      Then the explorer refuses by name
      And it does not answer the empty set, which would read as an install that recorded nothing

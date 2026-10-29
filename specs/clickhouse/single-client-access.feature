Feature: One ClickHouse client, reached one way, bounded where it can be seen

  Every statement this platform sends to ClickHouse goes through one client
  built in one place, and reaches its caller through a repository that the
  application object hands out. That is two rules with one purpose: a policy
  added to the client — bounded concurrency, retries, tenant scoping, logging,
  metrics — applies everywhere the moment it is added, and cannot be bypassed by
  a caller that constructs its own client or reaches around the repository.

  The bound matters most. A connection pool caps sockets, not statements. Work
  arrives from queues whose concurrency is set somewhere else entirely, so a
  process will happily try to run far more statements than it has sockets, and
  the surplus waits inside the pool: no timeout, no metric, no upper bound on
  the wait. The server then admits more than it can serve, rejects, and the
  retries go back into the same wall. Bounding the statements instead — with a
  queue that is finite and refuses when it is full — turns that invisible
  latency cliff into a refusal somebody can see, count, and alert on.

  Background:
    Given the platform is configured with a ClickHouse instance

  @unit
  Scenario: every client is built the same way
    Given the shared instance and a customer's own instance are both configured
    When the platform builds a client for each
    Then both carry the same concurrency bound, retry policy, logging and metrics
    And neither was assembled by hand at its call site

  @unit
  Scenario: statements are bounded, and the bound is the one that binds
    Given more statements are issued at once than the bound allows
    When the surplus statements are issued
    Then the statements beyond the bound wait for a slot rather than reaching the server
    And the number waiting and the number in flight are both reported

  @unit
  Scenario: a slot is held across retries, not taken per attempt
    Given a statement that fails transiently and is retried
    When the retry runs
    Then it keeps the slot it already holds
    And it does not rejoin the queue behind statements that arrived later

  @unit
  Scenario: an overloaded process refuses rather than queueing without limit
    Given the wait queue is already full
    When another statement is issued
    Then it is refused immediately with an error that names overload as the cause
    And the refusal is counted so the operator can see the platform shedding

  @unit
  Scenario: the wait queue is sized from the bound, never below its floor
    Given a bound of a few slots, and a bound of many
    When the platform sizes the wait queue for each
    Then each queue holds eight statements per slot, and never fewer than 64

  @unit
  Scenario: a caller that gives up stops waiting
    Given a statement is waiting for a slot
    When the caller abandons the request
    Then the statement leaves the queue instead of occupying it until a slot frees

  # The queue was bounded by depth but not by time, so a statement could wait
  # for as long as everything ahead of it took and THEN still spend the driver's
  # full request timeout on the wire. That is how a 46-second failure was
  # assembled out of two limits, neither of which was 46 seconds. Refusing is
  # not losing: overload classifies as transient, so a read retries and a job is
  # re-staged.
  @unit
  Scenario: a statement that waits too long is refused, not left waiting
    Given a statement is waiting for a slot
    When no slot frees before the wait bound elapses
    Then it is refused with an error that names overload as the cause
    And the refusal is classified as recoverable, so the job is re-staged rather than dropped
    And the statement already running is left alone
    And the wait bound is shorter than the time one statement may spend on the wire

  @unit
  Scenario: a same-tick statement blocked only on the total is still bounded
    Given the whole budget is taken within one tick
    When a statement with lane room but no total slot arrives in the same tick
    Then it is refused as overload rather than queueing indefinitely
    And the wait bound is armed at the total, where it is full

  # An insert holds its connection until the async insert flushes, so with one
  # shared bound a burst of ingest could occupy every slot and starve UI reads.
  # Each kind reserves a minimum of the shared budget for the other
  # (configurable via CLICKHOUSE_STATEMENT_LANE_RESERVE_SHARE) but may borrow the
  # rest when the other is idle, so neither can delay the other, a lone kind
  # still uses the whole budget less the other kind's reserve, and together they never exceed it.
  @unit
  Scenario: a saturated insert lane does not delay reads
    Given the insert lane has used every slot it may hold
    When a read is issued
    Then the read starts immediately
    And the surplus inserts keep waiting

  @unit
  Scenario: a saturated read lane does not delay inserts
    Given the read lane has used every slot it may hold
    When an insert is issued
    Then the insert starts immediately

  @unit
  Scenario: a lone kind of work borrows the idle lane's capacity
    Given only reads are being issued and no inserts
    When more reads are issued than a fixed half-budget would allow
    Then they all start, up to the whole budget less the inserts' reserve
    And the inserts' reserved slots stay free for an insert that may yet arrive

  @unit
  Scenario: both lanes together never exceed the connection budget
    Given both lanes have more statements than they can run
    When the statements are issued
    Then no more statements run at once than the whole budget allows

  # An async insert that waits for the server's flush holds its slot the whole
  # flush while the server does nothing for it. Writers that insert a row at a
  # time then spend slots at the rate rows arrive, so a burst fills the insert
  # lane and sheds rows while ClickHouse has CPU and memory to spare. The
  # server merges those rows into one flush anyway, so the client carries the
  # rows that wait for a slot together in one statement: the slots a burst
  # needs follow the tables being written, not the rows. Only inserts of one
  # route (tenant, organisation, tenant set) share, and only those that turn
  # async deduplication off explicitly: a deduplicated insert is known by its
  # own data, which a shared statement would change.
  @unit
  Scenario: async inserts waiting for a slot go as one statement
    Given the insert lane has used every slot it may hold
    When several async inserts of one route and table with the same settings are issued
    Then one statement carries all their rows once a slot frees
    And every caller learns the statement's outcome

  @unit
  Scenario: an async insert with a slot free goes at once, alone
    Given the insert lane has a free slot
    When async inserts are issued in the same tick
    Then each starts at once with its own rows

  @unit
  Scenario: only inserts that can share a statement share one
    Given the insert lane has used every slot it may hold
    When inserts are issued for different routes or tables, with different settings, with deduplication left on or tokened, or without waiting for the flush
    Then each that cannot share a statement goes in its own

  @unit
  Scenario: a coalesced statement never exceeds its row cap
    Given the insert lane has used every slot it may hold
    When more rows wait for one table than one statement may carry
    Then they go in as many statements as the cap requires
    And an insert larger than the cap goes in a statement of its own

  @unit
  Scenario: a refused coalesced statement refuses and counts every caller
    Given async inserts are waiting together for a slot that never frees
    When the wait bound elapses
    Then every caller is refused as overloaded
    And each caller counts as one shed statement

  @unit
  Scenario: a coalesced statement whose rows are rejected is resent caller by caller
    Given async inserts went together as one statement
    When the server rejects the statement's rows as unparsable before writing any
    Then each caller's rows are sent again in a statement of their own
    And only the caller whose rows the server rejects sees the failure

  # A reset, a timeout or a lost answer may come after the server wrote the
  # batch, and nothing deduplicates a resend, so the rows would land twice.
  @unit
  Scenario: a coalesced statement that may have written is never resent
    Given async inserts went together as one statement
    When the statement fails in a way that may have written its rows
    Then every caller sees that failure
    And no caller's rows are sent again

  @unit
  Scenario: coalesced inserts keep to the insert lane
    Given async inserts are waiting together for a slot
    Then reads still start at once
    And a saturated read lane does not delay them

  # Sizing the bound is where this went wrong in practice. The budget was read
  # as one server's allowance and then divided across the whole fleet, but the
  # cluster runs several nodes and the fleet's statements spread over all of
  # them. Dividing a single node's allowance by every pod understated the real
  # capacity by roughly the node count, so the platform throttled itself —
  # waiting seconds for a slot and refusing work — while the cluster sat mostly
  # idle and rejected nothing. A budget that is wrong in the safe direction is
  # still wrong: it produces refusals nobody can act on, and a warning that
  # fires forever teaches everyone to ignore it.
  Rule: The bound is sized from the cluster's real capacity

    @unit
    Scenario: The budget counts every node the cluster runs
      Given a cluster of several nodes each allowing the same number of concurrent queries
      When the platform sizes each process's bound
      Then the budget it divides is the whole cluster's capacity, not one node's
      And a fleet of the same size is allowed a proportionally larger bound

    @unit
    Scenario: A single-node cluster is sized exactly as before
      Given a deployment that does not say how many nodes its cluster has
      When the platform sizes each process's bound
      Then it assumes one node
      And the bound is the same one it chose before the cluster size was considered

    @unit
    Scenario: An operator override beyond the cluster budget is reported, not silently obeyed
      Given an operator sets a bound larger than the cluster budget allows
      When the platform sizes each process's bound
      Then it uses the operator's number
      And it reports that the fleet may exceed the cluster's concurrent-query budget

    @unit
    Scenario: An override within the corrected budget is not reported as excessive
      Given an operator sets a bound the cluster's full capacity can afford
      When the platform sizes each process's bound
      Then it uses the operator's number
      And it does not warn that the budget is exceeded

    @unit
    Scenario: An override above a known server cap is reported even when the fleet size is unknown
      Given a deployment that states the server's cap but not the fleet size
      And an operator sets a bound larger than one process's share of that cap
      When the platform sizes each process's bound
      Then it uses the operator's number
      And it reports that the bound may exceed the server's budget

    @unit
    Scenario: A known server cap bounds the fallback even when the fleet size is unknown
      Given a deployment that says what the server allows but not how many siblings a process has
      When the platform sizes each process's bound
      Then one process alone never claims more than the server's safe budget
      And it reports that the fleet may still exceed the budget, so the operator learns to supply the fleet size
      But a deployment that says nothing keeps the historical fallback unchanged

  # The client is where tenant scoping can be made unavoidable. In this schema
  # no identifier other than the tenant is unique across customers, so a read
  # that forgets its WHERE clause does not return too much - it returns somebody
  # else's rows, with the right shape and no error. The guard sits outermost on
  # the client every repository already calls, so it costs nothing when it
  # refuses and cannot be reached around. A statement that genuinely spans
  # tenants - a system table, an operator sweep, a billing meter - says so at the
  # call site in a written reason, which a reviewer sees as an added string
  # rather than as a silent omission.
  Rule: Every statement names its tenant, or says in writing why it does not

    @unit
    Scenario: A statement that names its tenant runs
      Given a read whose WHERE clause binds the tenant as a parameter
      When the repository issues it
      Then it reaches the server unchanged

    @unit
    Scenario: A statement that names no tenant is refused, and the refusal names the table
      Given a read with no tenant predicate at all
      When the repository issues it
      Then the client refuses it before it reaches the server
      And the refusal names the table and the beginning of the statement
      And it is recorded as an error for the engineer who wrote the query

    @unit
    Scenario: A statement that declares why it spans tenants runs
      Given a read that genuinely spans tenants and carries a written reason
      When the repository issues it
      Then the client lets it through
      And the reason does not travel to the server as part of the request

    @unit
    Scenario: An OR that can disjoin a tenant predicate away is refused
      Given a read with an OR beside a tenant predicate, or around the bracket that holds one
      When the guard checks it
      Then it is refused as a weakening disjunction

    @unit
    Scenario: An OR bracketed beneath a tenant predicate does not refuse a scoped statement
      Given a read whose every OR sits in a bracket beneath a predicate binding the claimed tenant
      And no OR shares a bracket with a tenant predicate or encloses one
      When the guard checks it
      Then it is accepted

  # A replay reads a batch's whole history in one statement; main streamed it so a batch's memory
  # stays bounded by its accumulators, not its event count (Alex, 2026-09-28). A streamed read is
  # guarded and routed like any other, but holds no slot and is never retried: its reader sets how
  # long it runs, and a retried stream would hand the reader rows it already applied.
  Rule: A large read streams batch by batch through the same routing and guard

    @unit
    Scenario: A streamed read yields the tenant's rows batch by batch from its own server
      Given a tenant whose organization has a private endpoint
      When a repository streams a read for that tenant
      Then it receives each batch as the server sends it, decoded
      And only the private endpoint is asked

    @unit
    Scenario: A streamed read spanning every tenant reads the shared server
      Given a read that names no tenant and carries a written reason
      When a repository streams it
      Then it is read from the shared server

    @unit
    Scenario: A streamed read that names no tenant is refused before it reaches a server
      Given a streamed read with no tenant predicate and no written reason
      When a repository streams it
      Then the client refuses it before any server is asked

    @unit
    Scenario: A driver that cannot stream answers the whole read as one batch
      Given a driver with no streaming read
      When a repository streams a read
      Then the whole result arrives as one batch

  # A server older than 25.11 that fails after sending 200 writes the failure into the body as a
  # last `{"exception": "Code: N. ..."}` row, and the vendor client hands that over as a row.
  Rule: A failure the server writes into a read's body fails the read

    @unit
    Scenario: A read whose body ends in the server's exception fails with the server's code
      Given a tenant read that the server fails after sending its first rows
      When a repository runs the read
      Then the read fails with the server's code and message
      And no row reaches the repository's decoder

    @unit
    Scenario: A streamed read whose last batch ends in the server's exception fails the stream
      Given a streamed tenant read that the server fails after sending its first batch
      When a repository streams the read
      Then the batches before the failure arrive
      And the stream then fails with the server's code

  @unit
  Scenario: ClickHouse is reached through a repository, from the application object
    Given a service needs data that lives in ClickHouse
    When it asks for that data
    Then it asks a repository it obtained from the application object
    And it never holds a ClickHouse client of its own

  @unit
  Scenario: a new bypass cannot be introduced unnoticed
    Given a change adds a direct ClickHouse client to a service, route or worker
    When the test suite runs
    Then the change fails a test that names the file and the rule it broke

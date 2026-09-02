Feature: Composing the join-request ledger in a background worker

  A join request carries two timers and nothing else wakes it: the day-7
  reminder to the organization's admins, and the day-14 lapse that moves a
  request from PENDING to EXPIRED. Both fire in whichever process holds the
  pipeline's process manager, and both end in an email.

  That email is why this ledger stayed in the application while the identity
  and directory-sync ones left. Everything else it takes is a Postgres binding
  — the `JoinRequest` head serving both the fold and its guards, the
  organization's admins, the requester's own name and address — and the one
  dependency that was not is now a packaged capability any process can compose
  from its own configuration.

  The pipeline mounts either way. Its five commands, its state projection and
  its lifecycle subscriber are named in the checked-in job registry, and the
  shared queue rejects an unroutable job for redelivery rather than dropping
  it, so a graph that mounted this only where mail happened to be configured
  would stall those seven forever with the pods up and the queue depth simply
  growing. Expiry is a fold besides: a request lapses on time whether or not
  anybody can be told.

  What can be absent is the mail, and it is absent by name — sends throw, the
  fan-out logs, and the request stands, which is what a deployment with no
  email provider already does. A process that claims the shared queue never
  reaches that state, because it refuses to compose without a gateway.

  @unit
  Scenario: A worker with a mail gateway mounts the join-request ledger itself
    Given a worker whose deployment named a host and an email provider
    When the composition is built
    Then it mounts the join-request ledger
    And routes exactly the keys the job registry names for it
    And it takes no join-request pipeline from the application

  @unit
  Scenario: A producer-only worker without mail still routes every key
    Given a worker whose deployment named no host
    When the composition is built
    Then it still mounts the join-request ledger and routes every key
    And a notification send is refused by name rather than reported as sent

  @unit
  Scenario: A consuming worker without mail refuses to compose
    Given a worker that would claim the shared event-sourcing queue
    When it has composed no mail gateway
    Then the composition is refused before anything is registered
    And the same graph composes once the deployment names its host

  @unit
  Scenario: The mail capability is closed with the graph that composed it
    Given a worker that composed a mail gateway
    When the process resource scope closes
    Then the mail transport is closed with it

  @unit
  Scenario: The worker builds the join-request ledger from its own client
    Given a process holding one typed Prisma client
    When it composes the join-request pipeline
    Then the pipeline registers the five commands, the fold and the lifecycle
    And the fold writes the JoinRequest row on that client

  @unit
  Scenario: One JoinRequest repository serves the fold and its guards
    Given a composed join-request pipeline
    When a guard reads a request's state
    Then it reads the rows the fold writes, through one repository

  @unit
  Scenario: The expiry wake dispatches a command rather than writing the row
    Given a composed join-request pipeline
    When the expiry wake fires
    Then it appends through the ledger and stages the expireJoin command
    And it notifies the requester only when something actually expired

  @unit
  Scenario: One bouncing admin address does not silence the rest
    Given an organization with several admins
    When the reminder cannot be delivered to one of them
    Then the others are still sent
    And the failure is logged without naming an address

  @unit
  Scenario: A notification with nobody to address is not sent
    Given a request whose requester has no address on file
    When the lapse notice would be sent
    Then nothing is sent

  @unit
  Scenario: Both graphs send one reminder, worded identically
    Given a join request that has waited a week
    When the reminder is rendered
    Then it is byte-for-byte the message the application renders
    And it links at the deployment's own members area and decides nothing

  @unit
  Scenario: Both graphs send one lapse notice, worded identically
    Given a join request nobody answered
    When the lapse notice is rendered
    Then it is byte-for-byte the message the application renders
    And it names nobody and gives no reason

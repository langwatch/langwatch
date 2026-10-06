Feature: Composing the join-request ledger in a background worker

  A join request carries two timers and nothing else wakes it: the day-7
  reminder to the organization's admins, and the day-14 lapse that moves a
  request from PENDING to EXPIRED. Both fire in whichever process holds the
  pipeline's process manager, and both end in an email.

  The identity module composes this pipeline itself, from its own repositories
  and its own event store, and hands its commands back through the senders the
  process connects (ConnectedIdentityEventing). The email goes out through the
  notification module, which owns the mail gateway, so identity holds no mail
  transport and the pipeline mounts in every process that installs identity.
  Its five commands, its state projection and its lifecycle subscriber are
  named in the checked-in job registry, and the shared queue rejects an
  unroutable job for redelivery rather than dropping it.

  @unit
  Scenario: The identity module composes the join-request ledger itself
    Given a process that installs the identity module
    When identity composes its join-request pipeline
    Then the pipeline registers exactly the commands, fold and lifecycle the job registry names

  @unit
  Scenario: The worker builds the join-request ledger from its own client
    Given a process holding one typed Prisma client
    When it composes the join-request pipeline
    Then the pipeline registers the five commands, the fold and the lifecycle
    And the fold writes the JoinRequest row on that client

  @unit
  Scenario: Split JoinRequest repositories share one Prisma client
    Given a composed join-request pipeline
    When a guard reads a request's state
    Then it reads the rows the fold writes, through the same Prisma client

  @unit
  Scenario: The expiry wake dispatches a command rather than writing the row
    Given a composed join-request pipeline
    When the expiry wake fires
    Then it appends through the ledger and stages the expireJoin command
    And the requester is told only once the expiry itself is recorded

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

  @unit
  Scenario: The arrival notifier counts prior approvals from the domain
    Given a domain with two requests already approved
    When a third request arrives
    Then the approved-from-domain count reaches the arrival mail

  @unit
  Scenario: The expiry notifier finds the requester's own personal project
    Given a requester who already holds a personal project
    When their request lapses
    Then the personal project link reaches the expiry mail
    And a requester with no personal project gets no link

  @unit
  Scenario: The auto-join notifier reads the same seat census as invitations
    Given an organization on a self-serve plan below its seat ceiling
    When a domain match joins somebody automatically
    Then the seats used and the seats the plan covers reach the notice
    And an organization on a negotiated plan gets no seat count

  @unit
  Scenario: Each join-request mail carries a delivery key naming its notice and its recipient
    Given a join request whose notice reaches two administrators
    When the notice is sent
    Then each administrator's mail carries its own delivery key
    And sending the same notice again derives the same keys
    And the mail reaches notification's sender with that key intact

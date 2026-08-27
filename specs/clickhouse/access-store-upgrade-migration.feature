Feature: Upgrading a clustered ClickHouse installation preserves existing access state

  As a LangWatch operator running a clustered ClickHouse installation
  I want the users, grants, row policies, settings profiles and named collections I
  already created to survive an upgrade, a rollback, and a scale from one replica to a
  cluster
  So that upgrading self-hosted ClickHouse never silently strips away who is allowed to
  do what

  This file specifies the upgrade lifecycle only. Steady-state replication on a freshly
  installed cluster is specs/clickhouse/replicated-access-storage.feature; do not
  duplicate those scenarios here.

  Background:
    Given a clustered ClickHouse installation is running
    And an admin has created a user, a grant, a row policy, a settings profile and a
      named collection through SQL

  # AC8, the replicated instance of AC1. Measured: total loss of all five classes on
  # every node, reproduced on four fresh clusters (issue #1168, Phase 1 results).
  @unimplemented
  Scenario: Upgrading the installation preserves every access entity that existed before it
    When the installation is upgraded to a release that manages access through the same
      store on every node
    Then the user, the grant, the row policy, the settings profile and the named
      collection are all still present and readable on every node
    And none of them is present on some nodes while missing on others

  # AC9, the replicated instance of AC2. Measured FAIL: authentication returns
  # AUTHENTICATION_FAILED because AC8's loss destroys the probe user itself.
  @unimplemented
  Scenario: A user created before the upgrade can still authenticate and query after it
    Given the row policy restricts what the created user may see
    When the installation is upgraded
    Then the user can still authenticate and run a query
    And the row policy still limits the rows that query returns, compared to what an
      administrator sees

  # AC22. Measured FAIL: the positive control itself fails (AUTHENTICATION_FAILED), so
  # the denial that follows is not evidence of enforcement, only of a missing user.
  @unimplemented
  Scenario: A denial after the upgrade is a permission denial, not a missing-user error
    Given the created user is not granted administrative privileges
    When the installation is upgraded
    And the user authenticates and then attempts an administrative operation it was never
      granted
    Then the user's authentication succeeds
    But the administrative operation is refused specifically as a permission denial

  # AC8-D on-issue half. Documents the finding as a named, evidenced loss rather than a
  # silent one, ahead of the migration existing.
  @regression
  Scenario: The loss of pre-existing access state across an upgrade is a documented, named finding
    When the installation is upgraded on the current release, with no migration of the
      access store
    Then every one of the five access entity classes is confirmed absent on every node,
      not merely unreported
    And the finding names a concrete operator migration path for recovering that access
      state

  # AC15a. Measured PASS: rollback restores the exact pre-upgrade distribution, including
  # its pod-local divergence. Nothing is destroyed, only stranded, and rollback proves it.
  @e2e
  Scenario: Rolling back an upgrade restores exactly the access state that existed beforehand
    When the installation is upgraded
    And the upgrade is then rolled back to the prior release
    Then the user, the grant, the row policy, the settings profile and the named
      collection are restored to exactly the state they were in before the upgrade

  # AC15b. Same guarantee, reached by upgrading back to the old release tag rather than
  # by helm rollback -- a materially different code path per the issue's Phase 1 finding.
  @e2e
  Scenario: Upgrading back to the prior release also restores the pre-upgrade access state
    When the installation is upgraded
    And the installation is then upgraded again, this time back to the prior release
    Then the user, the grant, the row policy, the settings profile and the named
      collection are restored to exactly the state they were in before the first upgrade

  # AC26, the replicated instance of AC3. Measured PASS: re-running an identical upgrade
  # duplicates nothing and does not roll pods a second time.
  @e2e
  Scenario: Repeating the same upgrade a second time is a no-op
    When the installation is upgraded
    And the identical upgrade is applied again with no changes
    Then no access entity is duplicated across any node
    And no node restarts as a result of the second, identical upgrade

  # AC12. Measured PASS: query failures during a rolling upgrade are confined to the
  # brief window a given pod is actually restarting, and recover promptly afterward.
  @e2e
  Scenario: Queries keep succeeding while an upgrade is rolling out across nodes
    When the installation is upgraded and the rollout is still in progress, with some
      nodes already upgraded and others not yet
    Then a query against the installation succeeds
    And the previously created access entities are still readable from a node that has
      not yet been upgraded
    And any query that does fail happens only while its node is restarting, and queries
      succeed again shortly after that node comes back

  # AC19, default-user half. Already true independently of the migration gap: `default`
  # is defined outside the access store, so it survives losing the store's backing quorum.
  @e2e
  Scenario: Losing quorum on the access store's backing coordination service does not lock out every user
    Given the coordination service backing the access store is running below the quorum
      it needs to serve writes
    When an operator authenticates as the installation's built-in default user
    Then that authentication still succeeds

  # AC19, SQL-user half. Currently unmeasurable: it depends on a SQL user surviving the
  # upgrade at all, which AC8 shows does not happen yet.
  @unimplemented
  Scenario: A SQL-managed user fails loudly, not silently, when the access store loses quorum, and recovers automatically
    Given the coordination service backing the access store is running below the quorum
      it needs to serve writes
    When the created user attempts to authenticate
    Then the attempt fails with a clear, immediate error rather than hanging
    When the coordination service regains quorum
    Then the created user's authentication and enforcement resume without any manual
      intervention, within a few minutes

  # AC11. Measured PASS-on-the-loss-branch: scenario reads as a pass only because the
  # entities end up verifiably absent everywhere, the same loss AC8 fails on -- not because
  # the transition is safe. Written here as the desired behaviour, which does not hold yet.
  @unimplemented
  Scenario: Growing from a single replica to a cluster does not silently strand access entities on the original node
    Given the installation is currently running as a single node, not a cluster
    When the installation is grown into a multi-node cluster
    Then the user, the grant, the row policy, the settings profile and the named
      collection created before the growth are present and readable on every node
    Or, if they cannot be carried over automatically, they are verifiably and consistently
      absent everywhere rather than present on some nodes and missing on others

  # AC11-D. Not on main: the guard exists only on an unpushed branch as of this writing.
  @unimplemented
  Scenario: Growing from a single replica to a cluster is refused until the access entities can be carried over safely
    Given the installation is currently running as a single node, not a cluster
    When an operator attempts to grow the installation into a multi-node cluster
    Then the upgrade is refused up front, before any node is changed
    And the refusal explains that existing access entities and table data would be
      stranded by the transition

  @unimplemented
  Scenario: Growing an already-clustered installation to more replicas is not blocked by the same guard
    Given the installation is already running as a multi-node cluster
    When an operator grows it to additional replicas
    Then the upgrade proceeds and is not refused

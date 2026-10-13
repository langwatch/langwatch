Feature: The skip-tenant-check-reason lint rule
  A ClickHouse statement or a raw Postgres statement skips the tenant guard only by
  setting `SKIP_TENANT_CHECK: true` (Alex, 2026-10-10). The guards count every skip at
  runtime; this rule makes each one carry its reason in the comment directly above the
  flag, and refuses the retired opt-outs, `unscoped:` and the `-- @tenancy:` SQL comment.

  @unit
  Scenario: A skipped tenant check with a real reason above it is left alone
    Given a statement whose `SKIP_TENANT_CHECK: true` has a comment of at least 20 characters directly above it
    When the skip-tenant-check-reason rule runs
    Then it reports nothing

  @unit
  Scenario: A skipped tenant check without a real reason is reported
    Given a `SKIP_TENANT_CHECK: true` with no comment, a short one, a placeholder such as TODO or tests, or one separated by a blank line
    When the skip-tenant-check-reason rule runs
    Then it reports missingReason

  @unit
  Scenario: The retired unscoped opt-out is reported
    Given a statement that carries `unscoped: { reason }` or `unscoped: CONSTANT`
    When the skip-tenant-check-reason rule runs
    Then it reports retiredUnscoped

  @unit
  Scenario: The retired tenancy comment is reported
    Given raw SQL in a string or a template that carries the retired tenancy comment
    When the skip-tenant-check-reason rule runs
    Then it reports retiredTenancyComment

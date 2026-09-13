Feature: Finding a trigger's newest fire reads one row, not its whole history

  The /api/health/triggers probe answers "did this trigger fire in the last
  hour" by looking at its newest TriggerSent row. One trigger can own most of
  the table, so the read has to be shaped so the database walks straight to
  the newest entry - equality on project and trigger, ordered by createdAt,
  one row - and served through the fire-history service like every other
  read of that table, rather than a hand-written query in the route.

  # Bindings:
  #   platform/app/src/server/app-layer/automations/trigger-fire-history.service.ts
  #   platform/app/src/server/app-layer/automations/repositories/trigger-fire-history.prisma.repository.ts
  #   platform/app/src/server/app-layer/automations/__tests__/trigger-fire-history.service.unit.test.ts
  #   platform/app/src/server/app-layer/automations/__tests__/trigger-fire-history.prisma.repository.unit.test.ts
  #   platform/app/prisma/migrations/20260907120000_trigger_sent_latest_fire_index/migration.sql

  @unit
  Scenario: The newest fire is asked for by project and trigger, newest first, one row
    Given a trigger with fire history
    When the newest fire is read
    Then the query filters on exactly the project and the trigger
    And orders by createdAt descending
    And asks for a single row

  @unit
  Scenario: The newest fire carries metadata only
    Given a trigger with fire history
    When the newest fire is read
    Then the row has no trace id and no captured trace content

  @unit
  Scenario: A trigger that never fired reads as nothing
    Given a trigger with no fire history
    When the newest fire is read
    Then the result is null

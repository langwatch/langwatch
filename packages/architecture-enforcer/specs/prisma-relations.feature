Feature: No new Prisma relation
  As a maintainer
  I want the schema's @relation lines held on a shrink-only list
  So that existing relations stay while no new one lands

  An eventually consistent system has no relations; existing ones stay and no new one lands
  (Alex, 2026-10-06). The Postgres migration scanner separately refuses a hand-written foreign key.

  @unit @architecture
  Scenario: A @relation is counted against the model that declares it
    Given a schema with relations on two models and a commented-out @relation
    When the schema's relations are counted
    Then each model holds its own count and the comment is not counted

  @unit @architecture
  Scenario: No model gains a @relation
    Given the checked-in list of today's @relation lines per model
    When the tree's schema.prisma is read
    Then no model holds more @relation lines than the list

  @unit @architecture
  Scenario: A removed @relation lowers the list in the same change
    Given the checked-in list of today's @relation lines per model
    When the tree's schema.prisma is read
    Then every model still holds its listed count

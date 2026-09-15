# Implementation:
#   packages/ui-host/src/slots.tsx
#   apps/ui/src/features/installed-ui-features.ts

Feature: A core screen leaves a slot for a block it may not name
  The sales card, the seat-type words, a plan's limit row and the managed
  provider notice all belong to packages a core feature must not import. The
  screen asks the composition for one by name. Only the composing application
  knows both halves, so only it decides what comes back — and a composition
  that decided nothing must still render, because an open-source deployment
  has no enterprise half to fill anything with.

  @unit
  Scenario: An unfilled slot renders the core fallback
    Given a screen rendered with no slot filled
    When it asks for the contact-sales block
    Then it renders its own fallback instead
    And nothing is thrown

  @unit
  Scenario: The application fills the slot with the enterprise component
    Given the browser application's installed features
    When its slots are read
    Then the contact-sales, resource-limit and managed-provider blocks are all filled
    And the seat-type words come from the licensing surface

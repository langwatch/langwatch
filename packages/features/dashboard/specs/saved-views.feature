@dashboard @backend
Feature: Saved views
  A project's saved views are the tab strip above a trace list. Most belong to
  the project and everyone sees them; a personal view belongs to one person.

  The transport has named this file since it was written. It did not exist
  until the service's behaviour was pinned, so the scenarios below are the
  rules the code already enforces, written down.

  Background:
    Given a project "Acme" with saved views

  # ── Who may change a view ────────────────────────────────────────────────
  #
  # A personal view is refused to anyone else as NOT FOUND, with the same
  # answer an unknown id gets. That is the point: a distinct "forbidden" would
  # tell the caller that the id names a real view belonging to someone else.

  @unit
  Scenario: A view the project shares can be changed by any member
    Given a saved view that belongs to the project
    When another member renames it
    Then the rename succeeds

  @unit
  Scenario: A personal view can be changed by its owner
    Given a saved view that belongs to me
    When I rename it
    Then the rename succeeds

  @unit
  Scenario: A personal view is refused to everybody else
    Given a saved view that belongs to another member
    When I try to rename it
    Then it is refused as not found
    And the view is left untouched

  @unit
  Scenario: The refusal does not reveal that the view exists
    Given a saved view that belongs to another member
    And an id that names no view at all
    When I try to delete each of them
    Then both refusals are the same

  # ── The default views ────────────────────────────────────────────────────
  #
  # Seeding is for the legacy tab strip only. The traces-v2 lens UI carries
  # its own defaults in code, so seeding on its behalf would show the customer
  # each default twice.

  @unit
  Scenario: A project nobody has opened yet is given the default views
    Given a project with no saved views
    When its views are listed
    Then the default views are created

  @unit
  Scenario: A project that already has views gains only the defaults it lacks
    Given a project holding some of the default views
    When its views are listed
    Then only the missing defaults are created

  @unit
  Scenario: A renamed default is not created again
    Given a project whose default view has been renamed
    When its views are listed
    Then nothing is created for it

  @unit
  Scenario: The traces-v2 lens strip is left alone
    Given a project with no saved views
    When its traces-v2 lens views are listed
    Then no views are created

  # ── Ordering ─────────────────────────────────────────────────────────────

  @unit
  Scenario: Reordering with an id the project does not have changes nothing
    Given a request to reorder views including an unknown id
    When the reorder is attempted
    Then it is refused and names the unknown id
    And no view's order is changed

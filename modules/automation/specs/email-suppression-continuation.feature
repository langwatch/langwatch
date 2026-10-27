# Implementation:
#   modules/automation/process/src/services/automation-email-suppression.service.ts
#   modules/automation/process/src/transport/email-suppression.trpc.ts
#
# The settings page lists every address that opted out of an automation's mail.
# A project that has collected many opt-outs should be read a page at a time,
# without the old whole-list read changing and without losing the audit trail.

Feature: The email suppression list is read a page at a time

  Background:
    Given a project with suppressed addresses, newest first

  Rule: A page continues exactly where the one before it stopped

    @unit
    Scenario: Pages walk the whole list once, in order
      Given more suppressions than fit one page
      When the pages are read one after the other from the first
      Then every suppression appears exactly once, newest first
      And only the last page has no continuation

    @unit
    Scenario: A list that fills the last page exactly does not promise another
      Given exactly as many suppressions as the page size
      When the first page is read
      Then it holds them all and has no continuation

    @unit
    Scenario: A project with no suppressions answers an empty last page
      Given a project with no suppressions
      When the first page is read
      Then it is empty and has no continuation

    @unit
    Scenario: Suppressions created in the same instant are neither repeated nor skipped
      Given several suppressions created at the same instant
      When the pages are read with a boundary inside that instant
      Then each of them appears exactly once, ordered by id

  Rule: The list may change between pages

    @unit
    Scenario: A suppression added after the first page does not repeat or displace rows
      Given the first page has been read
      When a newer suppression is added and the next page is read
      Then the next page continues after the first and shows each remaining row once

    @unit
    Scenario: A suppression removed between pages does not break the walk
      Given the first page has been read
      When the suppression its continuation points at is removed and the next page is read
      Then the next page continues from the same position

  Rule: A page shows only its own project

    @unit
    Scenario: A continuation taken from another project reveals nothing of it
      Given a continuation that names a position, not a project
      When it is used against a different project
      Then only that project's suppressions after the position are shown

    @unit
    Scenario: Each page names the automations it needs and no others
      Given a page whose rows name some automations and some are project-wide
      When the page is read
      Then the automation names are looked up for that page's rows only
      And a project-wide suppression carries no automation name

  Rule: The whole-list read is unchanged

    @unit
    Scenario: The whole-list read still answers every suppression with its automation name
      Given a project with several suppressions
      When the whole list is read
      Then every suppression is answered, as before

  Rule: Paged access is held to the same doors as the whole list

    @unit
    Scenario: A page is readable with the permission to view automations
      Given an operator who may view automations
      When they read a page
      Then the page is answered for that operator, with the default page size when none is given

    @unit
    Scenario: A page is refused without the permission to view automations
      Given an operator who may not view automations
      When they read a page
      Then they are refused

    @unit
    Scenario: A malformed continuation or page size is refused before any read
      Given a continuation with no id, or a page size outside the allowed range
      When the page is read
      Then the request is refused as malformed

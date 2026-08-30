# See dev/docs/adr/092-unified-authorization-engine.md, section
# "Instant checks: the epoch ladder"
#
# The two properties the cache exists to preserve are already specified,
# tagged and bound in specs/rbac/unified-authorization-engine.feature:
# "Repeated checks with unchanged grants read nothing from the database" and
# "Revoking a binding takes effect on the caller's next request". They are
# deliberately not restated here. This file covers what turning the cache on
# for everyone added: the bounds a held answer lives inside, what happens
# when the change signal cannot be read, and the lever an operator pulls.

@authz @cache
Feature: The grants cache and its epoch
  As a LangWatch customer
  I want a permission check I have already paid for to cost nothing the
  second time, and nothing I have had taken away to still answer for me
  So that the platform is fast on every screen without ever telling someone
  they may do a thing an administrator has already stopped them doing

  # Every organization now resolves through the engine, so every check that
  # is not answered from memory reads the grants a member holds afresh. The
  # cache holds one such reading per member per organization, and the
  # organization's own change counter - bumped by every grant write - is
  # what tells a held reading it is out of date.

  Background:
    Given an organization "acme"
    And user "alice" is a member of "acme"

  # ═══ The lever ════════════════════════════════════════════════════════

  @unit
  Scenario: The grants cache is on unless an operator turns it off
    Given no operator has said anything about the grants cache
    When the platform decides whether to answer alice from memory
    Then it answers from memory

  @unit
  Scenario: The kill switch works however an operator spells it
    Given an operator turning the cache off writes it shouted, or padded with spaces
    When the platform decides whether to answer alice from memory
    Then it resolves her grants afresh
    And an operator reaching for the switch mid-incident is not defeated by casing

  @unit
  Scenario: An unrecognised setting is not read as an instruction to stop
    Given an operator has written something the platform has no meaning for
    When the platform decides whether to answer alice from memory
    Then it answers from memory
    And the platform does not guess that a stop was intended

  @unit
  Scenario: An operator turns the grants cache off
    Given an operator has turned the grants cache off
    When alice's permissions are checked twice over
    Then both checks resolve her grants afresh
    And the platform never asks whether her organization has changed

  # ═══ Correct before fast ══════════════════════════════════════════════

  @unit
  Scenario: Checks stay correct when the change signal cannot be read
    Given the platform cannot tell whether "acme" has changed
    When alice's permissions are checked twice over
    Then both checks resolve her grants afresh
    And neither check answers from an older reading

  @unit
  Scenario: A held answer is never served indefinitely
    Given alice's grants were read once and nothing in "acme" has changed
    When enough time passes
    Then her next check resolves her grants afresh

  @unit
  Scenario: One member's held answer never answers for another
    Given alice and bob are both members of "acme"
    And alice is also a member of another organization
    When permissions are checked for each of them in each organization
    Then each member and organization is resolved on its own

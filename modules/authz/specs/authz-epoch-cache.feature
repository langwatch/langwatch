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
  Scenario: A key and its owner are read from one storage head when nothing is held
    Given the grants cache is off for "acme"
    And alice owns an API key and has just been demoted on the storage head being cut over to
    When the key is checked during the cutover
    Then the key's grants and alice's are read from the same storage head
    And the key is capped at her new role

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

  # ═══ Every change that moves access moves the epoch ═══════════════════

  @unit
  Scenario: A group membership change retires the organization's cached grants
    Given alice's grants were read once through her membership of group "reviewers"
    When she is removed from "reviewers", by an administrator or by the directory
    Then the organization's epoch moves
    And her next check resolves her grants afresh

  @unit
  Scenario: Removing a member retires their cached grants after the seat is gone
    Given alice's grants were read once and are held
    When an administrator removes alice from "acme"
    Then her membership is deleted before her grants are revoked
    And the epoch moves only after both, so no check in between is held

  # ═══ Checks asked with ids share the same held answer ═════════════════

  @unit
  Scenario: A check asked with ids answers from the held grants
    Given alice's grants were read once and nothing in "acme" has changed
    When her permissions are checked again by project id, as "any of these" and as a batch
    Then none of those checks resolves her grants afresh

  @unit
  Scenario: A revocation reaches a check asked with ids on the next request
    Given alice's grants were read once through a check asked with a project id
    When an administrator revokes her binding and the organization's epoch moves
    Then her next check by id, "any of these" and batch check are all denied

  @unit
  Scenario: A role change reaches a check asked with ids on the next request
    Given alice holds "admin" and her grants were read once through a check asked with ids
    When an administrator changes her role to "viewer" and the organization's epoch moves
    Then her next check by id answers as a viewer

  @unit
  Scenario: Demoting a key's owner reaches a check asked with ids on the next request
    Given an API key owned by alice was checked once by project id
    When alice is demoted and the organization's epoch moves
    Then the key's next check by id is capped at her new role

  # ═══ Where a scope sits ═══════════════════════════════════════════════

  # A project's team and organization change only when it moves or is
  # archived. Project records both as facts; authz moves the organization's
  # lineage signal from its own side, and a held lineage is checked against
  # it before it answers. The minute stays as a backstop.
  @unit
  Scenario: A scope's lineage is read at most once a minute
    Given project "chatbot" has been resolved to its team and organization once
    When the request door and the check both ask where "chatbot" sits, within a minute
    Then the lineage is not read again
    And after a minute it is read afresh

  @unit
  Scenario: An unknown or archived scope is never held
    Given project "chatbot" could not be found
    When it is asked about again
    Then the lineage is read afresh

  @unit
  Scenario: A moved project's lineage is read afresh on the next request
    Given project "chatbot" has been resolved to its team and organization once
    When project records that "chatbot" moved to another team
    And authz moves its organization's lineage signal
    Then the next ask of where "chatbot" sits reads the lineage afresh, within the minute

  @unit
  Scenario: An archived project stops resolving on the next request
    Given project "chatbot" has been resolved to its team and organization once
    When project records that "chatbot" was archived
    And authz moves its organization's lineage signal
    Then the next ask of where "chatbot" sits finds no scope

  @unit
  Scenario: Project's moved and archived facts move the organization's lineage signal
    Given authz subscribes to project's lifecycle facts
    When project records a project-moved or a project-archived fact
    Then the lineage signal of the fact's organization moves once per fact

  @unit
  Scenario: A lineage signal that cannot be read holds no lineage
    Given the lineage signal cannot be read
    When where "chatbot" sits is asked twice
    Then the lineage is read both times

  @unit
  Scenario: A lineage signal that cannot be moved is retried
    Given the lineage signal cannot be moved
    When project records that "chatbot" was archived
    Then authz's subscriber fails, so the delivery is retried

  @unit
  Scenario: Turning the grants cache off stops holding lineage too
    Given an operator has turned the grants cache off
    When where "chatbot" sits is asked twice
    Then the lineage is read both times

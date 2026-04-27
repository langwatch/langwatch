# LangWatch AI Gateway Governance — Compliance Baseline
#
# This spec captures the compliance posture the unified-trace governance
# architecture targets in this PR. It encodes the testable invariants the
# code must hold so a customer auditing LangWatch against SOC2 Type II /
# ISO 27001 / EU AI Act / GDPR / HIPAA-most-uses can map clauses to spec
# scenarios.
#
# Compliance posture targeted: SOC2 Type II, ISO 27001, EU AI Act, GDPR,
# HIPAA-most-uses (excluding HITECH strict tamper-evident audit).
#
# Cryptographic tamper-evidence (Merkle-root publication, write-once
# verification, key management) is FILED but NOT SHIPPED in this PR. It is
# the next hardening layer for the regulated finance / healthcare / govt
# segment. See specs/ai-gateway/governance/tamper-evidence-deferred.feature
# (planned follow-up) for the cryptographic-proof contract.
#
# Source-of-truth: append-only event_log + recorded_spans + log_records.
# Derived projections: governance_kpis fold, governance_ocsf_events fold.
# Routing artifact: hidden Governance Project per org, never user-visible.

Feature: Governance compliance baseline — append-only event log + retention + RBAC

  Background:
    Given the unified observability substrate is the single source of truth for governance events
    And recorded_spans and log_records are append-only via the event_log foundation (PR #3351)
    And every governance event carries origin metadata in the langwatch.origin.* namespace
    And derived governance KPI / OCSF read shapes live in dedicated fold projections
    And cryptographic tamper-evidence is filed as a follow-up hardening layer

  # ─────────────────────────────────────────────────────────────────────
  # Per-origin retention class — SOC2 / HIPAA / EU AI Act audit retention
  # ─────────────────────────────────────────────────────────────────────

  Scenario: An IngestionSource carries a retention class and the unified store honours it
    Given an org admin creates an IngestionSource with retention_class set to "archive"
    When events from that source land in the unified observability store
    Then each row carries the langwatch.governance.retention_class attribute set to "archive"
    And the underlying CH TTL policy applies the archive retention window to those rows
    And rows tagged with retention_class "operational" decay at the operational window
    And rows tagged with retention_class "compliance" decay at the compliance window

  Scenario Outline: Retention classes match the contractual posture customers expect
    Given an IngestionSource configured with retention_class "<class>"
    When a governance event lands tagged with that class
    Then the row is retained for at least "<minimum_retention>"
    And the org-plan ceiling caps the retention at the plans configured maximum

    Examples:
      | class       | minimum_retention | use_case                                        |
      | operational | 30 days           | day-to-day debugging, lowest cost               |
      | compliance  | 1 year            | SOC2 Type II / ISO 27001 audit window           |
      | archive     | 7 years           | EU AI Act high-risk / HIPAA / financial audit   |

  Scenario: Org-plan ceiling prevents over-configuration
    Given the orgs plan caps retention at 1 year
    When an admin attempts to set IngestionSource retention_class to "archive"
    Then the composer rejects the change with an explicit "plan ceiling: 1 year" error
    And no event is ever stored beyond the plan ceiling

  # ─────────────────────────────────────────────────────────────────────
  # Hidden Governance Project — internal routing artifact, never visible
  # ─────────────────────────────────────────────────────────────────────

  Scenario: Hidden Governance Project is auto-created on first IngestionSource mint
    Given an org has zero IngestionSources
    When an admin creates the orgs first IngestionSource
    Then a Project with kind "internal_governance" is auto-created for the org
    And the auto-created project never appears in any user-facing project surface

  Scenario: Hidden Governance Project never leaks to user-visible surfaces
    Given an org has a hidden Governance Project (kind = "internal_governance")
    When a user opens the project picker
    Then the hidden project does not appear in the picker
    When a user fetches GET /api/v1/projects
    Then the hidden project is not in the response
    When a user views the org billing export
    Then the hidden project is not in the export rows
    When a user views the project list in any admin / settings surface
    Then the hidden project does not appear in the list
    When the docs reference projects in a customer-facing context
    Then no docs page exposes the hidden Governance Project as a user concept

  Scenario: Project consumers must filter on kind to enforce the invariant
    Given a Project consumer renders a list of an orgs projects
    Then the consumer applies a filter "kind != 'internal_governance'"
    And any consumer missing this filter is treated as a bug, not a design tradeoff

  # ─────────────────────────────────────────────────────────────────────
  # RBAC — org admin / auditor read-only access; project members blocked
  # ─────────────────────────────────────────────────────────────────────

  Scenario: Org admins read governance events via project-membership on the hidden project
    Given a user with role "org_admin" in the org
    And the orgs hidden Governance Project exists
    Then the org admin has implicit read membership on the hidden project
    When the org admin queries /governance dashboard or any governance read API
    Then they see governance events for the org
    And they cannot mutate or delete governance events (read-only by role)

  Scenario: Project members of regular projects cannot see governance-origin events
    Given a user is a member of a regular project (kind != "internal_governance")
    And that user is NOT a member of the hidden Governance Project
    When the user opens /messages for their regular project
    Then they see only spans owned by their regular project
    And they do NOT see spans from any IngestionSource
    And origin filtering is enforced by the existing project-membership ACL, not by code at the read site

  Scenario: A dedicated auditor role gets read-only access without org-admin power
    Given an org admin assigns a user the role "auditor"
    Then the auditor gets read access to the hidden Governance Project
    And the auditor cannot mutate IngestionSources, AnomalyRules, or budgets
    And the auditor cannot read non-governance projects unless granted separately

  # ─────────────────────────────────────────────────────────────────────
  # Append-only event log — SOC2 / EU AI Act non-repudiation foundation
  # ─────────────────────────────────────────────────────────────────────

  Scenario: Governance events are durable via the existing event_log
    Given a governance event lands at the receiver
    When the event is processed through the trace-processing pipeline
    Then the event is appended to event_log before any projection writes
    And the event_log row is immutable (no UPDATE / DELETE on event_log)
    And projection rebuilds always replay from event_log as source of truth

  Scenario: UI deletion of derived view does not delete event_log evidence
    Given an admin clicks "Delete" on an entry in /governance dashboard
    Then the derived projection row may be hidden or marked deleted
    But the event_log row that produced it remains durable
    And re-running the projection from event_log re-creates the derived row

  # ─────────────────────────────────────────────────────────────────────
  # Tamper-evidence — explicitly deferred to a follow-up
  # ─────────────────────────────────────────────────────────────────────

  Scenario: Cryptographic tamper-evidence is NOT shipped in this PR
    Given a customer asks "do you publish a Merkle root over the audit log?"
    Then the answer is "not in this release"
    And the docs name cryptographic Merkle-root publication / write-once verification / key management as a follow-up hardening layer
    And no marketing copy claims cryptographic tamper-evidence is shipped
    And the append-only event_log is what currently satisfies non-repudiation for SOC2 Type II / ISO 27001 / EU AI Act / GDPR / HIPAA-most-uses customers

  Scenario: Tamper-evidence design is filed for the next hardening layer
    Given the next hardening layer is queued
    Then the design is captured in dev/docs/adr/<future>-cryptographic-tamper-evidence.md
    And the planned approach is a derived append-log over event_log (no parallel write path)
    And the contract names explicitly: Merkle-tree of event-log digests + periodic root publication + customer-rotatable signing keys + verification REST API
    And the regulated-industry segment that requires this is named: SEC 17a-4 broker-dealers, HIPAA HITECH strict, EU AI Act high-risk systems

  # ─────────────────────────────────────────────────────────────────────
  # Compliance scope summary — explicit framework coverage
  # ─────────────────────────────────────────────────────────────────────

  Scenario Outline: Each targeted compliance framework maps to specific architectural pieces
    Given a customer asks about "<framework>" coverage
    Then the architecture demonstrates coverage via "<mechanism>"
    And docs/ai-gateway/governance/compliance-architecture.mdx names this mapping explicitly

    Examples:
      | framework         | mechanism                                                                              |
      | SOC2 Type II      | per-origin retention + RBAC via hidden Gov Project + append-only event_log             |
      | ISO 27001         | same as SOC2 + access-control logging via existing audit trails                        |
      | EU AI Act         | per-event attribution (actor / action / target / cost / tokens) + retention + RBAC     |
      | GDPR              | PII redaction in trace pipeline + right-to-erasure via project-scoped delete + retention TTL |
      | HIPAA-most-uses   | retention archive class + RBAC + PII redaction (HITECH strict tamper-evident: deferred) |

  Scenario: Compliance scope doc is honest about deferred items
    Given the compliance-architecture docs page is published
    Then it names the targeted frameworks above
    And it explicitly names HITECH strict tamper-evident audit as DEFERRED
    And it explicitly names SEC 17a-4 / EU AI Act high-risk systems / regulated-industry signing requirements as DEFERRED
    And it links to the planned tamper-evidence ADR for customers who need that hardening layer

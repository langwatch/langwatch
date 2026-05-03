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
# segment.
#
# Source-of-truth: append-only event_log + recorded_spans + log_records.
# Derived projections: governance_kpis fold, governance_ocsf_events fold.
# Routing artifact: hidden Governance Project per org, never user-visible.
#
# Companion specs (this file references but does not duplicate):
# - event-log-durability.feature → append-only invariants, projection-rebuild semantics
# - retention.feature             → per-origin retention class mechanics + plan ceiling
# - folds.feature                 → governance_kpis + governance_ocsf_events derivation
# - receiver-shapes.feature       → per-source-type wire shape (spans vs logs)
# - architecture-invariants.feature → cross-cutting unified-substrate invariants
# - ui-contract.feature           → /governance UI contract + hidden-project filter discipline
# - siem-export.feature           → OCSF read API contract + thin push wrapper

Feature: Governance compliance baseline — append-only event log + retention + RBAC

  Background:
    Given the unified observability substrate is the single source of truth for governance events
    And recorded_spans and log_records are append-only via the event_log foundation (PR #3351)
    And every governance event carries origin metadata in the langwatch.origin.* namespace
    And derived governance KPI / OCSF read shapes live in dedicated fold projections
    And cryptographic tamper-evidence is filed as a follow-up hardening layer

  # ─────────────────────────────────────────────────────────────────────
  # Per-origin retention class — see retention.feature for mechanics
  # ─────────────────────────────────────────────────────────────────────
  #
  # The retention-class mechanics (per-IngestionSource config, langwatch.
  # governance.retention_class attribute stamping, CH TTL enforcement,
  # org-plan ceiling, default class) are the source of truth in
  # retention.feature. This compliance baseline references that contract
  # and asserts only the COMPLIANCE GUARANTEES it underwrites:

  Scenario: Retention class implementation underwrites the SOC2/HIPAA/EU-AI-Act audit windows
    Given retention.feature defines operational (30d) / compliance (1y) / archive (7y) classes with org-plan ceiling
    When a customer asks "can your retention meet our SOC2 / HIPAA / EU AI Act window?"
    Then the answer maps to the class their plan permits per retention.feature
    And no governance event survives past the plan ceiling regardless of source request

  # ─────────────────────────────────────────────────────────────────────
  # Hidden Governance Project — see architecture-invariants.feature + ui-contract.feature
  # ─────────────────────────────────────────────────────────────────────
  #
  # Auto-creation, kind-enum, never-leaks-to-user-visible-surfaces
  # invariants are the source of truth in architecture-invariants.feature
  # (the global rule) and ui-contract.feature (the UI-side enforcement
  # at every Project consumer). This compliance baseline references those
  # contracts and asserts only the COMPLIANCE GUARANTEE the invariants
  # underwrite:

  Scenario: Hidden Governance Project routing underwrites the access-control compliance posture
    Given architecture-invariants.feature defines Project.kind=internal_governance as auto-created and hidden
    And ui-contract.feature defines the filter discipline at every Project consumer
    When an auditor asks "can a non-org-admin reach our governance audit data?"
    Then the answer is no — RBAC via project-membership on the hidden project blocks them per ui-contract.feature
    And the hidden project never leaks to user-visible surfaces per architecture-invariants.feature
    And this satisfies the SOC2 Type II / ISO 27001 access-control control families for the audit-data scope

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
  # Append-only event log — see event-log-durability.feature for mechanics
  # ─────────────────────────────────────────────────────────────────────
  #
  # The append-only invariants (event_log immutability, projection rebuild
  # from event_log, deletion-of-derived-view-does-not-affect-event_log)
  # are the source of truth in event-log-durability.feature. This
  # compliance baseline references that contract and asserts only the
  # COMPLIANCE GUARANTEE the durability invariant underwrites:

  Scenario: Append-only event_log is the SOC2/ISO-27001/EU-AI-Act non-repudiation foundation
    Given event-log-durability.feature defines event_log as append-only with no UPDATE/DELETE API
    When an auditor asks "can a row be retroactively edited or deleted?"
    Then the answer is no — the durability invariants in event-log-durability.feature hold
    And projection rebuilds always replay from event_log as source of truth (per that spec)
    And derived-view deletion in the UI does not delete event_log evidence (per that spec)
    And this is what satisfies SOC2 Type II / ISO 27001 / EU AI Act non-repudiation requirements
    And cryptographic Merkle-root publication is filed as a follow-up hardening (see Tamper-evidence section below)

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

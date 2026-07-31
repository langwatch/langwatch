Feature: Anomaly detection — a rule's threshold breach surfaces as an alert
  As an organization admin
  I want a rule's threshold breach to surface as an alert I can review or route
  So that unusual spend or activity does not go unnoticed

  # Scope: this file owns firing semantics and alert shape — when a rule
  # fires and what the resulting alert says. Rule authoring (the settings
  # page, CRUD) is anomaly-rules.feature. Destination routing and delivery
  # (webhook retry, payload signing) is c3-alert-dispatch.feature. How a
  # rule gets evaluated — on an event, on a timer, or any other means — is
  # not this file's concern and must not appear in it: a customer cares
  # that a breach is found, not what noticed it.

  Background:
    Given the org admin has authored at least one active AnomalyRule

  # ---------------------------------------------------------------------------
  # spend_spike: the only rule type currently evaluated
  # ---------------------------------------------------------------------------

  @unit @unimplemented
  Scenario: a spend spike crossing the rule's threshold surfaces an anomaly
    Given an active spend_spike rule with a baseline large enough to be meaningful
    When spend in the current window exceeds the rule's threshold over its recent baseline
    Then an anomaly alert is recorded for the rule
    And the alert names the window and the spend that triggered it
    And the alert surfaces within the detection window

  @unit @unimplemented
  Scenario: a spend spike against a baseline too small to be meaningful does not surface an anomaly
    Given an active spend_spike rule whose recent baseline spend is smaller than the rule considers meaningful
    When spend in the current window would otherwise cross the ratio threshold
    Then no anomaly alert is recorded
    # A ratio alone can't tell real growth from noise on an account that
    # barely spends yet — the rule declines to fire rather than false-alarm.

  @unit @unimplemented
  Scenario: spend under the threshold does not surface an anomaly
    Given an active spend_spike rule with a meaningful baseline
    When spend in the current window stays under the rule's threshold
    Then no anomaly alert is recorded

  @unit @unimplemented
  Scenario: a rule does not surface a second anomaly for a window it already flagged
    Given a spend_spike rule already has an open alert covering the current window
    When the rule is evaluated again for that same window
    Then no second alert is recorded

  # ---------------------------------------------------------------------------
  # A rule type an admin can author today that nothing yet evaluates
  # ---------------------------------------------------------------------------

  @unit @unimplemented
  Scenario: an after_hours rule can be authored but does not yet fire
    Given an admin authors an active after_hours rule
    When activity matching its configured hours and threshold occurs
    Then no anomaly alert is recorded
    # after_hours is a valid ruleType in the authoring UI and the schema,
    # but nothing evaluates it yet. This is a real gap, not a spec error —
    # see anomaly-rules.feature for what authoring one looks like today.

  # ---------------------------------------------------------------------------
  # A disabled or archived rule stops firing on data that would otherwise trip it
  # ---------------------------------------------------------------------------

  @unit @unimplemented
  Scenario: a disabled rule does not fire
    Given a rule with status "disabled"
    When activity occurs that would otherwise trigger it
    Then no anomaly alert is recorded

  # ---------------------------------------------------------------------------
  # Tenant isolation
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: alerts are visible only within the organization that owns the rule
    Given two organizations each have a spend_spike rule that fires
    When an admin of one organization reviews its anomalies
    Then only that organization's alerts are visible
    And no alert belonging to the other organization is ever returned

  # ---------------------------------------------------------------------------
  # The alert is the durable record — routing is a separate, best-effort concern
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: a fired alert is visible on the dashboard even with no destination configured
    Given a rule with no destinations configured
    When the rule fires
    Then the alert is recorded and visible on the admin oversight dashboard
    # Destination routing and delivery are c3-alert-dispatch.feature's
    # contract, not this file's.

  @integration @unimplemented
  Scenario: a fired alert stays visible on the dashboard even when delivery to its destination fails
    Given a rule with a destination configured
    When the rule fires and delivery to that destination fails
    Then the alert is still recorded and visible on the admin oversight dashboard
    # Dispatch is best-effort; the alert row is authoritative regardless of
    # delivery outcome.

  # ---------------------------------------------------------------------------
  # Detection is independent of the governance UI
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: alerts keep firing while the governance preview flag is off for an org
    Given a customer org does not have the governance preview flag enabled
    And their AnomalyRules are still active
    When activity occurs that would trigger a rule
    Then an anomaly alert is still recorded
    And it surfaces the moment the org enables the flag
    # Same gating contract as the rest of governance ingestion: detection
    # is always on, the UI is what's flagged.

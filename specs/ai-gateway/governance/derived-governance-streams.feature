Feature: Derived governance streams are rebuildable from the event log
  The compliance posture in event-log-durability.feature rests on one claim:
  "folds and read projections are derived from those events; the source of
  truth is the event log". An auditor relies on that — it is what makes the
  append-only event log sufficient evidence rather than one record among
  several.

  # See dev/docs/adr/075-post-event-work-subscribers-and-process-managers.md
  #
  # Today two governance streams do not satisfy that claim. The OCSF audit
  # events (governanceOcsfEventsSync) and the KPI contributions
  # (governanceKpisSync) are written by reactors, and replay does not run
  # reactors — so neither can be rebuilt from the event log it is described as
  # deriving from. If one of those writes is lost, the event log still holds
  # the truth, but the audit stream disagrees with it and no replay closes the
  # gap.
  #
  # This is the difference between "an event was dropped" and "the audit trail
  # is wrong and cannot be corrected", which is the difference an auditor
  # cares about.
  #
  # Companion: event-log-durability.feature, folds.feature.
  # These scenarios are @unimplemented until ADR-075's Class C conversion lands.

  Background:
    Given the unified observability substrate is live
    And governance events are landing in the append-only event log

  Rule: an audit stream can be reconstructed from the event log

    @integration @unimplemented
    Scenario: The audit stream is rebuilt from the events it derives from
      Given governance activity recorded in the event log
      When the audit stream is rebuilt from those events
      Then it contains an entry for every governed activity in the log
      And each entry says what it said the first time

    @integration @unimplemented
    Scenario: An audit entry lost to a failure is recovered
      Given governed activity whose audit entry was never written
      When the audit stream is rebuilt from the event log
      Then the missing entry is present
      And the auditor cannot tell it was ever absent

    @integration @unimplemented
    Scenario: Rebuilding does not duplicate what is already recorded
      Given an audit stream that is already complete
      When it is rebuilt from the same events
      Then each governed activity is still represented once

  Rule: governance KPIs agree with the events they are computed from

    @integration @unimplemented
    Scenario: KPI contributions are reproducible
      Given governance activity that contributes to a reported KPI
      When the KPI contributions are recomputed from the event log
      Then the reported figures are unchanged

    @integration @unimplemented
    Scenario: A KPI that drifted is corrected by rebuilding
      Given a KPI figure that disagrees with the events behind it
      When the contributions are rebuilt from the event log
      Then the figure agrees with the events
      And it stays correct when rebuilt again

  Rule: the gap between the event log and a derived stream is detectable

    @integration @unimplemented
    Scenario: A derived stream that has fallen behind can be identified
      Given a derived governance stream
      When it is compared against the event log for a period
      Then any activity present in the log and missing from the stream is
        reported
      And the report names the period examined

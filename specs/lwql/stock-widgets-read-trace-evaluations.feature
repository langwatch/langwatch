Feature: The stock evaluation widgets read the evaluations the trace fold writes
  The stock evaluation widgets joined evaluation_metrics to trace_metrics to filter by the trace's
  period and source. The trace module now folds each evaluation's outcome into
  trace_evaluation_analytics, one live row per evaluation of a trace beside the trace's time and
  dimensions, writing a retraction (Sign -1) of the old row with every change. Two LangWatchQL
  views read it without FINAL: trace_evaluation_metrics, one row per evaluation, and
  trace_evaluation_checks, the live evaluations counted per narrow grain for the count widgets.
  Why: modules/analytics/adrs/007-settled-dedup-for-retraction-pair-projections.md.

  Rule: The views over trace_evaluation_analytics settle retraction pairs without FINAL

    @unit
    Scenario: trace_evaluation_metrics keeps each evaluation's live revision without FINAL
      Given the trace_evaluation_metrics view
      When it is rendered
      Then it groups by every source column it reads, Revision included and Sign excluded
      And it keeps a group whose signs sum above zero
      And it reads its table with no FINAL

    @unit
    Scenario: trace_evaluation_checks counts the live evaluations per narrow grain
      Given the trace_evaluation_checks view
      When it is rendered
      Then it groups by its grain, Source and TraceSource by the expressions they publish
      And Evaluations is the sum of the signs
      And it keeps a group only while its signs sum above zero

    @unit
    Scenario: A floored twin of a settled view reads the source from its bound before it groups
      Given a view over trace_evaluation_analytics
      When its floored twin is rendered
      Then the twin reads only the source rows at or after the floor, before the grouping

    @unit
    Scenario: A read bounded below on OccurredAt reads the settled view's floored twin
      Given a statement reading trace_evaluation_checks bounded below on OccurredAt
      When it is sent
      Then it reads trace_evaluation_checks__floor from that bound

    @unit
    Scenario: A settled view that declares no sign column is refused
      Given a view pinned to settled that declares no sign column
      When it is rendered
      Then provisioning refuses it by name

    @unit
    Scenario: Sign and Revision are granted for the dedup and exposed nowhere
      Given the views over trace_evaluation_analytics
      Then the source grant holds Sign and, where the view reads it, Revision
      And neither view exposes a column named Sign or Revision

    @unit
    Scenario: An aggregate reads a dated member's trace evaluations only for traces inside its window
      Given an aggregate project with a member shared from a date
      When a statement reads trace_evaluation_metrics or trace_evaluation_checks
      Then the member's rows are read from its start, and only for a trace inside its window

  Rule: The moved stock widgets read the trace evaluations in one read

    @unit
    Scenario: The moved stock queries read the trace evaluations, never evaluation_metrics
      Given the twenty-one stock queries that joined evaluation_metrics to trace_metrics
      When the catalogue stores their SQL
      Then each reads trace_evaluation_metrics or trace_evaluation_checks and no evaluation_metrics
      And each read is bounded below on OccurredAt and dated by TraceOccurredAt, except rag-failure-source/trend, which is dated by its spans on span_metrics
      And no stock query names Sign

    @unit
    Scenario: Judge agreement counts the narrow view's evaluations for thumbed traces only
      Given the Needs attention widget's judge agreement query
      When the catalogue stores its SQL
      Then it sums Evaluations over trace_evaluation_checks
      And it reads only the traces a reviewer thumbed in the period

    @unit
    Scenario: Only the evaluation side of a mixed stock query moves
      Given the capability gap and failure source queries
      When the catalogue stores their SQL
      Then the capability gap example is still looked up in traces
      And the failure source spans are still read from span_metrics

    @unit
    Scenario: A stock query over the trace evaluations keeps both the evaluation's and its trace's source to the list
      Given a stock query that reads trace_evaluation_metrics or trace_evaluation_checks
      When the sources parameter is added
      Then its WHERE keeps both Source and TraceSource in the list

    @unit
    Scenario: Every read of the trace evaluations in a moved stock query reads the floored twin
      Given a moved stock query
      When it is sent
      Then each trace evaluation read goes to its view's floored twin

    @integration
    Scenario: Each moved stock query returns the rows main's form returned
      Given traces, evaluations and their trace evaluation rows of each source
      When each moved query runs under the application list and under the langy list
      Then it returns the rows main's join of evaluation_metrics to trace_metrics returned
      And it returns the rows the query returned before the move

    @integration
    Scenario: An unmerged retraction pair counts the evaluation once, at its latest outcome
      Given an evaluation whose outcome changed, its retraction pair not merged
      When trace_evaluation_metrics is read
      Then the evaluation is read once, with its latest outcome

    @integration
    Scenario: A trace whose copied columns changed is read with their new values
      Given a trace whose customer changed after its evaluations were written
      When the segment pass rates are read
      Then its checks count under the new customer only

    @integration
    Scenario: A trace whose second trace_metrics row lands later in the period counts once
      Given a trace with a judge outcome and a topic whose anchor moved later inside the period
      When all the moved queries are read, trace_metrics read once per trace at its latest row
      Then each returns the rows the query returned before the move

    @integration
    Scenario: A trace moved into the period from before it counts in the period
      Given a trace dated before the period whose anchor moved inside it, with outcome and check re-runs inside it
      When all the moved queries are read, trace_metrics read once per trace at its latest row
      Then each returns the rows the query returned before the move

    @integration
    Scenario: A moved pre-freeze trace counts once, at its latest time, on the real views
      Given a trace dated in the previous period with one passed check and one outcome
      When its anchor moves into the period and ck-kpis reads the real views
      Then its check and its outcome each count once, in the period
      And neither counts in the previous period any more

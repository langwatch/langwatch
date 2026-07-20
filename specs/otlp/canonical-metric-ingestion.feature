Feature: Canonical OTLP metric ingestion

  Metrics sent over OTLP are stored as they were observed, so the platform can
  answer questions about them later that nobody thought to ask at ingest time.

  A data point is identified by its own content, so the same point arriving
  twice is the same point. Correlating a point to a trace is a separate,
  best-effort concern: a metric is accepted once it is safely stored, whether
  or not it can be tied to a span.

  See ADR-055 for the architectural decisions behind this.

  Background:
    Given a project that accepts OTLP metrics

  Rule: Observed data survives ingestion

    Scenario: A histogram keeps its bucket layout
      When the project sends a histogram data point with explicit bounds and
        bucket counts
      Then the stored point still reports those bounds and counts
      And its sum, min and max are preserved

    Scenario: A typed value keeps its type
      When the project sends an integer data point
      Then the stored point reports an integer value
      And it is not reported as a floating point value

    Scenario: Metric identity does not depend on the machine that received it
      Given two receivers process the same data point
      Then both derive the same identity for it
      And the point is stored once

  Rule: Invalid points are rejected, and say so

    Scenario: A non-finite value is refused rather than stored as nothing
      When the project sends a data point whose value is not a finite number
      Then the response reports that point as rejected
      And no point is stored for it

    Scenario: A malformed batch is counted, not crashed on
      When the project sends a request whose metric container is malformed
      Then the response reports the affected points as rejected
      And the remaining well-formed points are still accepted

    Scenario: A batch where every point is malformed is not acknowledged as accepted
      When the project sends a request in which no data point is valid
      Then the response does not report the batch as fully accepted

  Rule: The server never tells a client to discard data the server is holding

    Scenario: Storage trouble asks the client to retry
      Given the platform cannot durably store incoming points
      When the project sends a valid batch
      Then the response tells the client the request is retryable
      And the response does not report the points as rejected
      And the response does not disclose internal failure detail

    Scenario: A point that cannot be tied to a span is still accepted
      Given a data point carries an exemplar that cannot be correlated to a span
      When the project sends it
      Then the point is accepted
      And the failure to correlate is not reported to the sender

  Rule: Over-plan usage is refused at the door

    Scenario: A batch beyond the project's plan limit is rejected
      Given the project is over its metrics plan limit
      When the project sends a batch of data points
      Then the response reports the points as rejected
      And the reason is visible to the sender

  Rule: Rolled-up metrics can always be rebuilt

    Scenario: A late point corrects the summaries around it
      Given a series already has points either side of a 30 second window
      When a point arrives late for that window
      Then the summaries covering it reflect the late point
      And summaries for untouched windows are unchanged

    Scenario: Reprocessing a point does not change the result
      Given a data point has already been processed
      When the same point is processed again
      Then the stored point and its summaries are unchanged

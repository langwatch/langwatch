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

    Scenario: Storage trouble asks the client to retry the metric batch
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

    Scenario: A batch beyond the project's plan limit is refused
      Given the project is over its metrics plan limit
      When the project sends a batch of data points
      Then the batch is refused with a reason the sender can read
      And no data point reaches storage

  Rule: Rolled-up metrics can always be rebuilt

    Scenario: A late point corrects the summaries around it
      Given a series already has points either side of a rollup window
      When a point arrives late for that window
      Then the summaries covering it reflect the late point
      And summaries for untouched windows are unchanged

    Scenario: Reprocessing a point does not change the result
      Given a data point has already been processed
      When the same point is processed again
      Then the stored point and its summaries are unchanged

  # A batch of points once produced a storage request that grew with the batch:
  # a parameter set and a whole query branch per point. Storage rejected one
  # such request outright, having read the request's own encoding as part of
  # the query. It stopped happening when an unrelated change made the requests
  # smaller, which is not the same as bounding them - a larger batch would have
  # crossed the same line again. These scenarios bound it.
  #
  # Bounded, not constant: the summary-window read still costs a seek per
  # window by design, because folding it would trade a single-row index seek
  # for a scan of the whole retention window. What every scenario here holds to
  # is a stated ceiling the batch cannot push a request past.
  Rule: Rebuilding summaries sends a request bounded independently of the batch

    @unit
    Scenario: A folded rollup read sends a fixed-size request
      Given a batch of points for one series
      When the platform looks up what follows each of them
      Then the request it sends is the same whether the batch holds one point
        or hundreds

    @unit
    Scenario: A folded rollup read binds a fixed number of parameters
      Given a batch of points
      When the platform looks up what follows each of them
      Then the number of values bound into the request does not grow with the
        batch
      And a batch too large for one request is split rather than sent whole

    @unit
    Scenario: A folded rollup read keeps its encoded request inside a budget
      Given a batch of points touching any number of series
      When the platform looks up what follows each of them
      Then every request it sends stays under a stated size, however many
        series the batch touches

    @unit
    Scenario: A folded rollup read leaves the stored payload behind
      Given a batch of points
      When the platform looks up what follows each of them
      Then it does not ask for the stored payload it never reads

    @unit
    Scenario: A folded rollup read resolves the successors a per-point read did
      Given a batch of points whose series already holds points between them
      When the platform looks up what follows each of them in one request
      Then it resolves the same following point for each as it would asking
        one at a time
      And it recomputes exactly the same summary windows

    @unit
    Scenario: A rollup bucket read sends the window size and retention span once
      Given a summary window has to be recomputed
      When the platform reads the points that window covers
      Then the request carries the window size and the retention span once,
        not once per window
      And a full request of window seeks still fits the size a request may be

    @integration
    Scenario: A batch folds to the summaries a point-at-a-time rebuild produces
      Given a series already holds points between the points of a batch
      When the batch is folded in one pass
      Then its summaries match those of an identical series rebuilt one point
        at a time
      And every sample is counted exactly once across the windows

    @integration
    Scenario: A batch carrying several series folds each of them correctly
      Given a batch carries points for several series recorded at different
        times
      When the batch is folded in one pass
      Then each series' summaries match those of the same series rebuilt one
        point at a time
      And every sample of every series is counted exactly once

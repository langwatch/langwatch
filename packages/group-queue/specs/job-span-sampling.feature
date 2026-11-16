Feature: A claimed job keeps its consumer span for 1 in 10 successes and every failure
  As the queue every fold and command runs through
  I want most successful jobs to build no tracing span at all
  So that the worker spends its time on the work, while every failure stays traceable

  The decision is made before the span exists. A job carrying a producer trace decides by its
  trace id, so every job in one trace agrees; a job without one draws from a random source the
  queue's options can replace. An unsampled job runs under a context that is not sampled, so the
  handler's own spans are dropped rather than exported as roots. When an unsampled job fails, its
  span is created then, starting at the job's start, with the error recorded. The ratio is
  JOB_SPAN_SAMPLE_RATIO (0.1). Execution, retry, dead-letter and metrics are unchanged.

  @unit
  Scenario: An unsampled successful job creates no span and computes no custom attributes
    Given a job the sampler leaves out
    When its handler succeeds
    Then no span is exported
    And the queue's custom span attributes are never computed

  @unit
  Scenario: A failed job always has a span carrying its error
    Given a job the sampler leaves out
    When its handler fails
    Then one span is exported, starting at the job's start
    And it carries the exception, an error status, the producer link and its attributes

  @unit
  Scenario: A retried attempt always has a span
    Given a sampling ratio of 0
    When a job runs its second or later attempt
    Then the job is sampled

  @unit
  Scenario: The sampled share of first attempts is the configured ratio
    Given the default ratio and an injected random source spread evenly over 10,000 jobs
    When each first attempt is decided
    Then exactly 1 in 10 jobs is sampled

  @unit
  Scenario: Jobs in one producer trace share one decision
    Given several jobs that carry the same producer trace id
    When each is decided
    Then every job gets the same decision, taken from the trace id and not the random source

  @unit
  Scenario: An unsampled job's child spans are not exported as roots
    Given a job the sampler leaves out
    When its handler starts spans of its own
    Then none of them is exported

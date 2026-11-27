Feature: A claimed job keeps its consumer span for 1 in 10 successes and every failure
  As the queue every fold and command runs through
  I want most successful jobs to build no tracing span at all
  So that the worker spends its time on the work, while every failure stays traceable

  The decision is made before the span exists. A job carrying a producer trace decides by its
  trace id, so every job in one trace agrees; a job without one draws from a random source the
  queue's options can replace. An unsampled job runs under a context that is not sampled, so the
  handler's own spans are dropped rather than exported as roots. When an unsampled job fails, its
  span is created then, starting at the job's start, with the error recorded, in the trace its
  earlier logs carry, under a sampled remote parent so it survives any root ratio. A span kept up
  front starts its own trace, as before this sampling: a process sampler with a root ratio below 1
  may still drop it. The ratio is JOB_SPAN_SAMPLE_RATIO (0.1). Execution, retry, dead-letter and
  metrics are unchanged.

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

  @unit
  Scenario: A failed job's span joins the logs written before the failure
    Given a job the sampler leaves out
    And its handler writes a log before it fails
    When its span is exported
    Then the span's trace id is the trace id on that log

  @unit
  Scenario: An error escaping the job is recorded on its span
    Given a job the sampler leaves out
    When an error escapes the queue's own failure handling
    Then one span is exported with the exception and an error status
    And the error is rethrown

  @unit
  Scenario: A span kept up front starts its own trace
    Given a job the sampler keeps
    When the job runs
    Then its span is a trace root with no parent
    And a process sampler whose root ratio keeps nothing drops it like any root

  @unit
  Scenario: An unsampled job's failure span survives a process sampler that samples no root
    Given a job the sampler leaves out
    And a process sampler whose root ratio keeps nothing
    When its handler fails
    Then its span is exported under a sampled remote parent

  @unit
  Scenario: A failure span keeps an attribute the job set over a custom attribute
    Given a job the sampler leaves out, whose custom attributes name the tenant
    When its handler sets the tenant attribute itself and then fails
    Then the exported span carries the handler's value

  @unit
  Scenario: A failure span keeps the events recorded before the failure
    Given a job the sampler leaves out
    When its handler records an event with attributes at a known time and then fails
    Then the exported span carries that event with its attributes and its time

  @unit
  Scenario: A hand-back past its window is recorded on an unsampled job's span
    Given a first attempt the sampler leaves out, first handed back longer ago than the window
    When its handler hands it back again
    Then one span is exported with the exception and an error status

  @unit
  Scenario: An unsampled cross-group batch that succeeds exports no span
    Given a cross-group batch the sampler leaves out
    When every group's call succeeds
    Then no span is exported

  @unit
  Scenario: An unsampled cross-group batch that fails exports one error span
    Given a cross-group batch the sampler leaves out
    When its call fails for good
    Then one span is exported with an error status

  @unit
  Scenario: A hand-back is not recorded on an unsampled job's span
    Given a first attempt the sampler leaves out
    When its handler hands it back, once and again
    Then no span is exported, because a hand-back is not a failure

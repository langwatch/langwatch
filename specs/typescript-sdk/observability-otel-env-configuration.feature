# OpenTelemetry JS 2.x providers and batch processors read the OTEL_ sampling, limit and
# batching variables themselves. The 3.x `TracerProvider` and `BatchSpanProcessor` read none
# of them, so the SDK reads them, or a process sampling 10% through the environment would
# export every trace. An option given to setup always beats the environment.

Feature: OpenTelemetry environment variables still configure LangWatch tracing on JS 3.x

  Background:
    Given a Node process setting up LangWatch observability on OpenTelemetry JS 3.x

  @unit
  Scenario: A sampler named in OTEL_TRACES_SAMPLER decides which traces are kept
    Given OTEL_TRACES_SAMPLER is "traceidratio" and OTEL_TRACES_SAMPLER_ARG is "0"
    When a span ends
    Then it is not exported

  @unit
  Scenario: Every standard sampler name in OTEL_TRACES_SAMPLER builds that sampler
    Given OTEL_TRACES_SAMPLER names always_on, always_off, traceidratio, parentbased_always_on, parentbased_always_off or parentbased_traceidratio
    When the sampler is built from the environment
    Then it is the sampler that name stands for, with OTEL_TRACES_SAMPLER_ARG as its ratio

  @unit
  Scenario: A sampler given to setup beats OTEL_TRACES_SAMPLER
    Given OTEL_TRACES_SAMPLER is "always_off"
    And setup is given an always-on sampler
    When a span ends
    Then it is exported

  @unit
  Scenario: Span limits come from the OTEL_ variables unless setup is given them
    Given OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT is "1"
    When a span with three attributes ends
    Then it keeps one attribute
    And a limit given to setup wins over the variable, field by field

  @unit
  Scenario: Batch span processors take their queue and timing from OTEL_BSP_ variables
    Given OTEL_BSP_MAX_QUEUE_SIZE is "1"
    When three spans end before the batch is flushed
    Then the spans that do not fit the queue are dropped

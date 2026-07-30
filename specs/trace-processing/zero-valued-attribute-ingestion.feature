Feature: Zero-valued attribute ingestion

  Zero is a measurement, not an absence. A cached completion emits zero output
  tokens and costs nothing; a deterministic call runs at temperature zero; a
  first-attempt success retried zero times; a cache miss is a flag that is
  false. Each of those is something a customer's SDK went out of its way to
  report, and each is the answer to a question the product asks — "how many
  output tokens did this turn use?" has the answer "none", which is not the
  same answer as "this SDK never told us".

  So an attribute that arrives carrying zero, zero-point-zero, or false is
  recorded with that value. It is never omitted, because once it is omitted the
  trace can no longer tell the two answers apart: the token count reads as
  unreported, the cost never enters the trace's totals, and the flag reads as
  though the instrumentation does not emit it at all. The same rule holds
  whichever wire encoding the value arrives in — integer, float, text, the
  64-bit split form some SDKs emit, or an element inside a reported list — and
  whether it is reported per span or once for the whole emitting service.

  The one value that is genuinely absent is one that cannot be read as a number
  at all. That stays absent rather than being recorded as zero, so a garbled
  figure never masquerades as a real measurement of none.

  Background:
    Given a project receiving traces from an instrumented application

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A whole numeric attribute of zero is recorded as zero
    Given a span reporting a whole-number attribute whose value is zero
    When the span is ingested
    Then the span carries that attribute with the value zero

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A fractional numeric attribute of zero is recorded as zero
    Given a span reporting a fractional attribute whose value is zero
    When the span is ingested
    Then the span carries that attribute with the value zero

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: An attribute reported as false is recorded as false
    Given a span reporting a flag attribute whose value is false
    When the span is ingested
    Then the span carries that attribute as false rather than as unreported

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A zero sent in text form is recorded as zero
    Given a span reporting a numeric attribute whose value is the text "0"
    When the span is ingested
    Then the span carries that attribute with the value zero

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A zero sent in the SDK's split 64-bit form is recorded as zero
    Given a span reporting a numeric attribute in the split form some SDKs use for large integers
    And both halves of that value are zero
    When the span is ingested
    Then the span carries that attribute with the value zero

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A zero inside a reported list of numbers survives the list
    Given a span reporting a list attribute whose entries include zero
    When the span is ingested
    Then the list on the span still holds the zero in its reported position

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: Zeros survive a list of reported entries rebuilt from its parts
    Given a span reporting a list of usage entries whose values are zero
    When the span is ingested
    Then every entry in the rebuilt list still carries its zero

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: Both settings of a flag survive a list of reported entries
    Given a span reporting a list of entries in which one flag is true and another is false
    When the span is ingested
    Then the rebuilt list holds both the true flag and the false one

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A usage report made entirely of zeros keeps every figure
    Given a span from a cached completion reporting zero output tokens, zero cost, a temperature of zero, and a cache-hit flag of false
    When the span is ingested
    Then every one of those figures is present on the span with its reported value
    And the input-token count it reported alongside them is unchanged

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A zero reported once for the whole service reaches the trace
    Given an application reporting a numeric attribute of zero for the service rather than per span
    When a span from that service is ingested
    Then the trace's attributes carry that attribute with the value zero

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A number that cannot be read stays absent rather than becoming zero
    Given a span reporting a numeric attribute whose value is not a number
    When the span is ingested
    Then the span carries no such attribute at all

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A zero input-token count from an older SDK reaches the span's metrics
    Given a span from an SDK that reports usage in the older attribute shape
    And it reports an input-token count of zero
    When the span is ingested
    Then the span's metrics record an input-token count of zero

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A zero output-token count from an older SDK reaches the span's metrics
    Given a span from an SDK that reports usage in the older attribute shape
    And it reports an output-token count of zero
    When the span is ingested
    Then the span's metrics record an output-token count of zero

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A streaming flag reported as false is recorded as false
    Given a span reporting that the call was not streamed
    When the span is ingested
    Then the span's parameters record streaming as false

  @bdd @trace-processing @ingestion @zero-values @unit
  Scenario: A time to first token of zero is recorded rather than discarded
    Given a span reporting that its first token arrived with no measurable delay
    When the span is ingested
    Then the span's first-token time is its own start time

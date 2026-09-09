Feature: Vendor span canonicalisation
  As a platform operator
  I want every supported instrumentation SDK to canonicalise to the same span shape
  So that traces read the same regardless of which vendor emitted them

  Each vendor canonicaliser detects spans emitted by its instrumentation, maps
  vendor-specific attributes and events onto the canonical `gen_ai.*` keys, and
  leaves everything else untouched. A canonicaliser that guesses at an
  unrecognised shape, silently overwrites a value an earlier extractor already
  set, or drops conversation order produces a trace that reads correct but
  isn't.

  Background:
    Given a span emitted by the vendor's instrumentation

  Rule: Strands canonicalises its spans to the shared shape

    @unit
    Scenario: A span is recognised as Strands by any of its detection signals
      Given the span carries one of Strands' detection signals (instrumentation
        scope name, gen_ai.system, system.name, service.name, or
        gen_ai.agent.name)
      When the canonicaliser runs
      Then the span is treated as a Strands span

    @unit
    Scenario: A span with none of Strands' detection signals is left untouched
      Given the span carries none of Strands' detection signals
      When the canonicaliser runs
      Then no canonical attribute is set

    @unit
    Scenario: A known operation name maps to its canonical span type
      Given the span's gen_ai.operation.name is chat, execute_tool, or invoke_agent
      When the canonicaliser runs
      Then the canonical span type is llm, tool, or agent respectively

    @unit
    Scenario: An unrecognised operation name is dropped rather than guessed at
      Given the span's gen_ai.operation.name is not one Strands maps
      When the canonicaliser runs
      Then no canonical span type is set

    @unit
    Scenario: Role-named events become an ordered input-message list
      Given the span carries interleaved user/assistant/tool role events
      When the canonicaliser runs
      Then the canonical input messages preserve the original event order

    @unit
    Scenario: A system-role event is promoted to the system instruction and dropped from input
      Given one of the role events is a system message, first or not
      When the canonicaliser runs
      Then the system instruction carries its content and the input messages omit it

    @unit
    Scenario: An input-messages attribute already present upstream is never overwritten
      Given the span already carries a canonical input-messages attribute
      When the canonicaliser runs
      Then the existing value is left in place and no event extraction happens

    @unit
    Scenario: Choice events become output messages, defaulting role to assistant
      Given a gen_ai.choice event with and without an explicit role
      When the canonicaliser runs
      Then the output message role defaults to assistant only when none was given

    @unit
    Scenario: Content is read from the first candidate attribute present, in a fixed order
      Given an event carries content under one of content, gen_ai.content,
        message, text, or gen_ai.prompt.content
      When the canonicaliser runs
      Then the content is extracted from whichever candidate is present, with
        content taking precedence when more than one is

    @unit
    Scenario: A recorded model marks the span as matched
      Given the span carries gen_ai.request.model, only gen_ai.response.model, or neither
      When the canonicaliser runs
      Then the span is recorded as matched only when a model is present

    @unit
    Scenario: Canonicalisation never touches span linkage fields
      Given the span carries a parent span id
      When the canonicaliser runs
      Then the parent span id is unchanged

  Rule: OpenInference canonicalises its spans to the shared shape

    @unimplemented
    Scenario: A span emitted by OpenInference instrumentation canonicalises to the shared shape

  Rule: Logfire canonicalises its spans to the shared shape

    @unimplemented
    Scenario: A span emitted by Logfire instrumentation canonicalises to the shared shape

  Rule: Mastra canonicalises its spans to the shared shape

    @unimplemented
    Scenario: A span emitted by Mastra instrumentation canonicalises to the shared shape

  Rule: Haystack canonicalises its spans to the shared shape

    @unimplemented
    Scenario: A span emitted by Haystack instrumentation canonicalises to the shared shape

  Rule: Spring AI canonicalises its spans to the shared shape

    @unimplemented
    Scenario: A span emitted by Spring AI instrumentation canonicalises to the shared shape

  Rule: LangWatch's own SDK canonicalises its spans to the shared shape

    @unimplemented
    Scenario: A span emitted by the LangWatch SDK canonicalises to the shared shape

  Rule: Legacy OTel spans canonicalise to the shared shape

    @unimplemented
    Scenario: A span with no vendor-specific signal canonicalises via the legacy OTel path

  Rule: Copilot canonicalises its spans to the shared shape

    @unimplemented
    Scenario: A span emitted by Copilot instrumentation canonicalises to the shared shape

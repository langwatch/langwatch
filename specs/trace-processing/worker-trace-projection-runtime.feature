Feature: The trace projection runtime composes outside the application
  The trace-processing pipeline folds every span LangWatch ingests. Today the
  four things it computes with — the input/output extraction, the media
  references the summary strips render, the per-span cost, and the lean
  projection payload — live in the application, so a standalone worker cannot
  build the pipeline at all: fourteen of its twenty-nine routing keys have no
  definition to be registered into, and an unroutable job is redelivered
  forever rather than dropped.

  This feature is about the four collaborators becoming package code, and about
  a worker process being able to build the whole trace pipeline from packages
  alone. Nothing is mounted: the application still owns every registration and
  keeps its own copy of each collaborator. What has to be true today is that
  the composition CAN be built, and that both copies answer identically —
  because while both graphs ingest, a customer's trace may be folded by either.

  Background:
    Given the application still owns the trace pipeline registration
    And the worker composition root holds only what a standalone process has

  Rule: Input and output extraction answers the port from the package

    @unit
    Scenario: the packaged extraction reads the same semantic attributes
      Given a span carrying GenAI input messages and LangWatch output
      When the packaged extraction is asked for each side through its port
      Then it reports the GenAI messages as the input and names them as its source
      And it reports the LangWatch value as the output and names that as its source

    @unit
    Scenario: a span with no semantic attributes falls back rather than reporting nothing
      Given a span whose only input is a stringified payload
      When the packaged extraction is asked for its rich value and then its fallback
      Then the rich value is absent
      And the fallback reports the payload's text

  Rule: The media reference format is written and read the same way

    @unit
    Scenario: a reference the projection wrote is read back whole
      Given a span payload carrying a stored image and a stored recording
      When the references are collected, serialised and parsed back
      Then the parsed references carry the same kinds, addresses and roles

    @unit
    Scenario: a reference to anywhere but our own file route is refused
      Given a payload whose media points at an external address
      When the references are collected
      Then no reference is produced
      And a crafted stored attribute naming that address is refused on the way back in

    @unit
    Scenario: the strips never grow past the preview budget
      Given a payload carrying more distinct media than a summary strip shows
      When the references are collected and merged with an existing list
      Then only the budgeted number survive
      And the winning span's media stays at the front

    @unit
    Scenario: the agent's reply and the caller's media land on different strips
      Given references recorded for an assistant turn and for a user turn
      When each side of the summary asks which references belong to it
      Then the assistant's media shows on the output side only
      And everything else, including media with no role, stays reachable

  Rule: Fold-time cost is priced from the platform's own catalog

    @unit
    Scenario: a span is priced from the model the provider answered with
      Given a span reporting one model on its request and another on its response
      When the packaged cost estimate prices it through the projection runtime
      Then it is priced from the response model

    @unit
    Scenario: a customer's own rates on the span still win
      Given a span carrying per-token override rates
      When the packaged cost estimate prices it
      Then the override rates decide the cost rather than the catalog

  Rule: The lean projection payload keeps its pointer back to the full value

    @unit
    Scenario: an oversized input is previewed and left a pointer
      Given a span whose captured input is far larger than the preview budget
      When the event is prepared for projection
      Then the stored value is a preview within the budget
      And a reserved pointer names the attribute and the event carrying the whole value

    @unit
    Scenario: the event the pipeline was handed is never altered
      Given a span whose captured input is far larger than the preview budget
      When the event is prepared for projection
      Then the original event still carries its full value

    @unit
    Scenario: a small event is passed straight through
      Given a span whose attributes are all inside the budget
      When the event is prepared for projection
      Then the very same event comes back

  Rule: A standalone worker can build the whole trace pipeline

    @unit
    Scenario: the pipeline is composed from packages alone
      Given the worker composition root and no application module
      When it builds the trace processing pipeline
      Then the pipeline is named for trace processing
      And it registers every routing key the frozen job registry lists for it

    @unit
    Scenario: the composed pipeline actually uses the collaborators it was given
      Given the worker composition root
      When it builds the trace processing pipeline
      Then the extraction, the media references, the cost estimate and the lean
        payload preparation it was handed are the ones the pipeline runs

    @unit
    Scenario: the converted pipeline is mounted by the production composition
      Given the worker's own source tree
      When every module that names the trace pipeline composition is listed
      Then the production composition is the only caller outside its tests

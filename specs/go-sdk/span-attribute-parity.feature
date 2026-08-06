Feature: Go SDK span attribute parity
  The LangWatch Go SDK records LLM observability data as span attributes that
  the trace-processing pipeline understands, matching the TypeScript and Python
  SDKs. A Go developer attaches typed inputs and outputs, metrics, metadata,
  RAG contexts and binary attachments to a span, and the canonical ingestion
  layer promotes them to the trace without any per-SDK fix-ups.

  Background:
    Given a Go program tracing through the LangWatch OTLP exporter

  Rule: Typed input and output values

    Scenario: A string input is recorded as text
      When the developer sets a plain string as the span input
      Then the span carries an input value of type "text"

    Scenario: A struct input is recorded as json
      When the developer sets a struct as the span input
      Then the span carries an input value of type "json"

    Scenario: Chat messages are recorded as chat_messages
      When the developer sets a slice of chat messages as the span input
      Then the span carries an input value of type "chat_messages"
      And the canonical pipeline derives the gen_ai input messages from it

    Scenario: The developer forces a value type
      When the developer records output explicitly as a guardrail result
      Then the span carries an output value of type "guardrail_result"

  Rule: Binary attachments travel inside chat messages

    Scenario: A developer attaches an image to a message
      When the developer adds a binary content part with a mime type and bytes
      Then the content part is recorded as type "binary" with inline base64 data
      And the ingest pipeline can externalise it to a stored object

    Scenario: A developer references an already-stored object
      When the developer adds a binary content part referencing a stored object id
      Then the content part is recorded as type "binary" with that id and no inline data

  Rule: Metrics use the canonical metric fields

    Scenario: Token usage and cost are recorded
      When the developer sets prompt tokens, completion tokens and cost on the span
      Then the span metrics expose those fields with snake_case names
      And the trace totals account for the tokens and cost once

  Rule: Span metadata is hoisted to the trace

    Scenario: Reserved metadata is promoted to trace identity
      When the developer sets a thread id, user id and customer id as span metadata
      Then the trace is grouped under that thread, user and customer

    Scenario: Custom metadata is hoisted as first-class attributes
      When the developer sets a custom metadata field on a span
      Then the trace exposes that field as a metadata attribute

  Rule: RAG contexts use the canonical attribute

    Scenario: Retrieved chunks populate the span contexts
      When the developer records the retrieved document chunks on a RAG span
      Then the span contexts list those chunks
      And legacy or unrecognised context attribute spellings are not emitted

  Rule: GenAI attributes follow the current semantic conventions

    Scenario: The provider is named with the current convention
      When the OpenAI instrumentation traces a chat completion
      Then the span names the gen_ai provider
      And request messages are recorded as chat_messages rather than opaque json

    Scenario: Reasoning output tokens use the current usage convention
      When the developer records reasoning output tokens on an LLM span
      Then the span metrics expose the reasoning token count

    Scenario: A legacy reasoning token attribute still counts
      Given an older SDK that only emits the legacy reasoning token attribute
      When the span is canonicalised
      Then the span metrics expose the reasoning token count
      And the current convention wins when both attributes are present

    Scenario: Time to first chunk populates the trace time to first token
      When the developer records the time to first streamed chunk in seconds
      Then the trace summary records that time to first token in milliseconds

    Scenario: A streaming request is flagged on the span
      When the developer marks the request as streaming
      Then the span records that the request was streamed

  Rule: Live span feedback becomes a tracked event

    A developer records feedback against a live span — a thumbs up or down,
    a star rating — as a `langwatch.event` span event. The trace-processing
    pipeline turns it into a tracked event on the trace, identical to a
    `POST /api/events/track` call, so SDK-emitted and REST-emitted feedback
    are indistinguishable downstream.

    Scenario: A thumbs-up vote on a span becomes a tracked event
      When a span carries a langwatch.event feedback event with a vote and a comment
      Then a tracked event of that type is attached to the trace
      And the event metrics carry the vote
      And the event details carry the comment

    Scenario: A malformed feedback event is ignored
      When a span carries a langwatch.event event with no event type
      Then no tracked event is attached to the trace

  Rule: Data capture gates input and output content

    Scenario: Capturing nothing strips input and output
      Given an exporter configured to capture no content
      When a span carrying input and output is exported
      Then the exported span carries neither input nor output content
      And its metrics, metadata, model and identity are preserved

    Scenario: A predicate decides capture per span
      Given an exporter whose data-capture predicate returns none for tool spans
      When a tool span and an llm span are exported
      Then the tool span's input and output are stripped
      And the llm span's input and output are preserved

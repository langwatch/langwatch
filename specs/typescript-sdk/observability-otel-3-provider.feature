# langwatch 3.x runs on OpenTelemetry JS 3.x, which ships one `TracerProvider`
# (`@opentelemetry/sdk-trace`) and no NodeTracerProvider or BasicTracerProvider.
# The SDK finds a provider by its span processor registry, never by class name,
# so an application's own 3.x provider is still one LangWatch can join.

Feature: Joining an OpenTelemetry JS 3.x tracer provider

  Background:
    Given a Node process running OpenTelemetry JS 3.x

  @unit
  Scenario: A 3.x provider handed over directly is one LangWatch can attach to
    Given a TracerProvider from @opentelemetry/sdk-trace
    When LangWatch looks for a provider to attach to
    Then it finds that provider

  @unit
  Scenario: A 3.x provider registered globally is found behind the API proxy
    Given a TracerProvider registered as the global tracer provider
    When LangWatch looks for a provider through the OpenTelemetry API
    Then it finds the registered provider behind the proxy

  @unit
  Scenario: Something that only looks like a tracer provider is not taken for one
    Given an object with a getTracer method but no span processor registry
    When LangWatch looks for a provider to attach to
    Then it finds none

  @unit
  Scenario: Attaching to an existing 3.x provider sends spans to the caller's exporter
    Given a TracerProvider registered as the global tracer provider
    And setup is asked to attach to the existing provider with an exporter of the caller's
    When a span ends
    Then the caller's exporter receives it
    And shutdown removes the processors setup added

  @unit
  Scenario: A dedicated 3.x provider gets LangWatch's processor and the global one is left alone
    Given a TracerProvider passed to setup as its dedicated provider
    When setup runs
    Then that provider gains the LangWatch processor
    And no global provider is registered

  @unit
  Scenario: The Next.js re-check finds the 3.x provider LangWatch registered
    Given the Next.js Node runtime
    And LangWatch sets up observability on its own
    When the global provider is checked again a tick later
    Then the provider found behind the proxy is an OpenTelemetry JS 3.x TracerProvider
    And no missing-provider error is logged
    And spans still reach the exporter

  @unit
  Scenario: A tracer taken before the provider is registered records through either api build
    Given a LangWatch tracer taken before any provider is registered
    And a provider registered later through the other module build of @opentelemetry/api
    When the tracer starts spans
    Then the registered provider records them

  @unit
  Scenario: A child span started after an await keeps its parent
    Given LangWatch sets up observability on its own, with its default context manager
    When a child span starts after an await inside an active parent span
    Then the child's parent span id is the parent's span id

  # CommonJS only: an ESM app links every module before any SDK code runs, so it gets Node's
  # "does not provide an export named 'SeverityNumber'" instead; the docs name both.
  @unit
  Scenario: An OpenTelemetry API older than 1.10 is refused with a message saying what to install
    Given @opentelemetry/api older than 1.10 is installed
    When the SDK loads
    Then it refuses with an error naming the supported range ">=1.10.0 <1.11.0"
    And the error says to stay on langwatch 2.x while the app runs OpenTelemetry JS 2.x

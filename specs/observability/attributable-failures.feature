Feature: A repeating failure says whose it is

  Some failures arrive thousands per hour and are the same sentence every time:
  an integration sending an empty credential, a project whose evaluator names a
  model provider it never enabled, a key refused the permission its requests
  need. Each of those is one caller's problem, and each is already logged with
  the identifiers that would say which caller — the path, the user agent, the
  project, the key, the provider.

  None of it survives. The log pipeline keeps a record's message and drops the
  structured fields around it, so what reaches the log store is the bare
  sentence repeated. You can count the failures. You cannot say whose they are,
  group them, or tell "one customer misconfigured something" apart from "this
  broke for everyone" — which are the same line and very different incidents.

  So the identifiers are recorded on the trace as well, where they survive and
  can be filtered. The log line already carries the trace id, so the two halves
  join. This is not about logging more; it is about the diagnosis outliving the
  hop to the log store.

  Scenario: an authentication failure records who was calling
    When a request arrives without usable credentials
    Then the failure records the route, the method and the calling agent
    And it records whether a credential was sent but empty, which separates a
      misconfigured integration from one that never authenticated at all

  Scenario: a rejected credential records what was rejected
    Given a request whose credential does not resolve
    When it is refused
    Then the failure records the kind of credential that was refused

  Scenario: refused ingestion records whose it was
    Given a key that lacks the permission its request needs
    When the request is refused
    Then the failure records the project, the key and the permission that was
      missing

  Scenario: a skipped evaluation records which evaluator and whose project
    Given a project whose evaluator needs a provider it has not configured
    When the evaluation is skipped
    Then the skip records the project, the evaluator and the reason it skipped
    And the reason distinguishes an unconfigured provider from a missing
      evaluator

  Scenario: an evaluation that cannot run names the provider and the model
    Given an evaluator whose model names a provider the project has not enabled
    When the evaluation runs
    Then the failure names both the provider and the model it was needed for
    And it records the project alongside them

  Scenario: recording diagnostics never changes what happens
    Given there is no trace in progress
    When a failure records its diagnostics
    Then nothing is recorded and the failure proceeds unchanged

  Scenario: absent context is omitted rather than recorded as empty
    Given some of the identifying context is unavailable
    When the failure records its diagnostics
    Then only the context that exists is recorded

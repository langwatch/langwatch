Feature: Core OTLP protection applies Enterprise policy without owning it
  Governance owns ingestion-source classification and billing policy.
  Core OTLP mechanics protect authenticated identity on every ingestion path.

  Scenario Outline: Receiver identity wins over sender and configured policy
    Given a parsed <signal> request for authenticated API key key_real
    And the sender supplied forged API key attributes at resource and nested levels
    And the Enterprise resource policy removes or overwrites the API key attribute
    When the receiver applies its policy
    Then each surviving resource contains exactly one API key attribute with key_real
    And no nested payload-supplied API key attribute survives
    Examples:
      | signal  |
      | traces  |
      | logs    |
      | metrics |

  Scenario: A credential without an API key row leaves no key attribute
    Given an ingestion-source secret or legacy project key authenticated the request
    When the receiver protects attribution
    Then all supplied API key attributes are removed
    And no null or fabricated API key attribute is written

  Scenario: Metrics cannot hide keys in points or exemplars
    Given a metric has forged API key attributes on points and exemplar filtered attributes
    When the receiver protects attribution
    Then those attributes are removed
    And unrelated values and attributes are preserved

  Scenario: VS Code policy excludes inherited telemetry
    Given Governance resolves policy for a copilot_vscode ingestion key
    When trace or metric scopes contain Copilot and unrelated instrumentation
    Then only github.copilot and @github/copilot scopes survive
    And empty resource groups are removed
    But log scopes are not filtered

  Scenario: Metrics retain the existing billing distinction
    Given Governance resolves an ingestion source's bundled-plan policy
    When receiver policies are built
    Then traces and logs carry the resolved non-billable marker
    And metrics remove sender-supplied markers without adding one

  Scenario: Missing policy never accepts unattributed ingestion-source traffic
    Given a scoped ingestion-source credential has no available Governance policy
    When a valid body reaches provenance handling
    Then the receiver responds with retryable service unavailable
    And no command is queued

  Scenario: Failed policy lookup preserves malformed-body precedence
    Given policy lookup fails for an authenticated ingestion-source credential
    When that request contains malformed JSON
    Then the receiver responds with bad request
    And no command is queued

  Scenario: A policy error retains its handled response after valid parsing
    Given the policy resolver returns a handled refusal
    When an authenticated ingestion-source request contains a valid body
    Then the receiver returns that refusal's original status and code
    And no command is queued

  Scenario: Receiver protection preserves future wire fields
    Given a request contains resource counters, scope versions, span identifiers and metric values
    When receiver attribution is applied
    Then those unrelated wire fields are retained

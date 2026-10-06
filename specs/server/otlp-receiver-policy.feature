Feature: Core OTLP protection applies Enterprise policy without owning it
  Governance owns ingestion-source classification and billing policy.
  Core OTLP mechanics protect authenticated identity on every ingestion path.

  @unit
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

  @unit
  Scenario: A credential without an API key row leaves no key attribute
    Given an ingestion-source secret or legacy project key authenticated the request
    When the receiver protects attribution
    Then all supplied API key attributes are removed
    And no null or fabricated API key attribute is written

  @unit
  Scenario: Metrics cannot hide keys in points or exemplars
    Given a metric has forged API key attributes on points and exemplar filtered attributes
    When the receiver protects attribution
    Then those attributes are removed
    And unrelated values and attributes are preserved

  @unit
  Scenario: VS Code policy excludes inherited telemetry
    Given Governance resolves policy for a copilot_vscode ingestion key
    When trace or metric scopes contain Copilot and unrelated instrumentation
    Then only github.copilot and @github/copilot scopes survive
    And empty resource groups are removed
    But log scopes are not filtered

  @unit
  Scenario: Metrics retain the existing billing distinction
    Given Governance resolves an ingestion source's bundled-plan policy
    When receiver policies are built
    Then traces and logs carry the resolved non-billable marker
    And metrics remove sender-supplied markers without adding one

  @unit
  Scenario: Missing policy never accepts unattributed ingestion-source traffic
    Given a scoped ingestion-source credential has no available Governance policy
    When a valid body reaches provenance handling
    Then the receiver responds with retryable service unavailable
    And no command is queued

  @unit
  Scenario: Failed policy lookup preserves malformed-body precedence
    Given policy lookup fails for an authenticated ingestion-source credential
    When that request contains malformed JSON
    Then the receiver responds with bad request
    And no command is queued

  @unit
  Scenario: A policy error retains its handled response after valid parsing
    Given the policy resolver returns a handled refusal
    When an authenticated ingestion-source request contains a valid body
    Then the receiver returns that refusal's original status and code
    And no command is queued

  @unit
  Scenario: Receiver protection preserves future wire fields
    Given a request contains resource counters, scope versions, span identifiers and metric values
    When receiver attribution is applied
    Then those unrelated wire fields are retained

  # Q82 (Alex, 2026-10-06): governance records a billing fact; trace folds it and reads its own row at ingest.
  @unit
  Scenario: Governance records the billing fact when a coding-assistant config changes
    Given an organization's coding-assistant config is created, changed, disabled or removed
    When governance has written the change
    Then it records one billing fact per assistant kind for that organization
    And a kind is billed only while an enabled config of that kind is off a bundled plan
    And a tile that is not a coding assistant records no fact

  @unit
  Scenario: A backfill records the billing fact for configs written before it existed
    Given organizations whose coding-assistant configs predate the billing fact
    When the backfill runs
    Then every organization holding an enabled coding-assistant config records its billing facts

  # Unimplemented: trace does not yet fold the billing fact or read it at ingest (handoffs/port-otlp-fact-fold.md); every receiver answers 503 for an ingestion-source key.
  @unimplemented @integration
  Scenario: An ingestion-source key reaches every receiver with Governance's policy
    Given a copilot_vscode ingestion-source key
    When it posts traces, logs or metrics to the OTLP receivers
    Then the receiver answers 200
    And it stamps source, origin and organization, and the non-billable marker on traces and logs only
    And non-Copilot scopes are dropped from traces and metrics but not from logs

  # Unimplemented: trace does not yet fold the billing fact (handoffs/port-otlp-fact-fold.md).
  @unimplemented @unit
  Scenario: Trace folds the billing fact and an absent row is non-billable
    Given governance recorded a billing fact for an organization's source
    When trace folds it into its own projection
    Then ingest reads billed from trace's row, keeping the latest fact per source
    And a source with no row is stamped non-billable, as main's failure default

Feature: Azure deployment resolution on the control-plane / virtual-key dispatch path
  As a customer whose Azure OpenAI provider is configured in LangWatch and used
  through a virtual key
  I want the deployment map for my Azure, Bedrock or Vertex model to reach the
  provider key
  So that my calls carry the right deployment, and so that when a configuration
  IS genuinely wrong I am told it is a configuration error rather than a
  retryable timeout.

  Context (langwatch-saas#1016). Two independent defects.

  Defect A — the deployment self-map on the dispatch path — now lives on main via
  PR #7778, covered by specs/ai-gateway/azure-endpoint-from-api-base.feature. Its
  self-map helper (domain.WithDeploymentSelfMap) is called on both the Dispatch
  and DispatchStream lanes there. What remains unique to this change, and is
  covered here, is the wire contract that builds a credential's deployment_map on
  the control-plane / virtual-key path, and the forwarding of that map into the
  provider key's aliases for every deployment-mapped provider — Azure, Bedrock and
  Vertex. bifrost v1.5 moved model->deployment mapping off the vendor key configs
  onto Key.Aliases; Azure and Bedrock already forwarded it, and Vertex did not.

  Defect B: a Bifrost error carrying no status code is classified as a timeout,
  so a permanent configuration failure is surfaced to clients as HTTP 504 and is
  retried through the whole credential fallback chain on every request.

  Background:
    Given a project with an Azure OpenAI provider slot on a virtual key
    And the slot's resource endpoint and API key are correct

  # --- A. Wire contract: the control-plane deployment_map ---

  @unit
  Scenario: A configured deployment_map reaches the provider verbatim
    Given the provider slot maps a model to a custom deployment name
    When the credential for that slot is built
    Then that mapping is present unchanged and no entry is overwritten

  @unit
  Scenario: An empty deployment_map is treated the same as an absent one
    Given the provider slot carries a deployment_map that is present but empty
    When the credential for that slot is built
    Then it carries the same deployments map as a slot with no deployment_map field

  # --- B. Key-alias forwarding for every deployment-mapped provider ---

  @unit
  Scenario Outline: Every deployment-mapped provider forwards its deployment map to the key aliases
    Given a <provider> credential on the control-plane path
    When its self-map is applied for a model and it is converted to a provider key
    Then the model->model self-map is present in the key aliases when no deployment_map was configured
    And an explicit deployment_map is forwarded into the key aliases verbatim

    Examples:
      | provider |
      | azure    |
      | bedrock  |
      | vertex   |

  @unit
  Scenario Outline: Providers without deployments are left untouched
    Given a <provider> provider slot on the control-plane path
    When the credential for that slot is built
    Then its deployment map is still nil
    And no Azure key configuration is fabricated for it

    Examples:
      | provider  |
      | openai    |
      | anthropic |

  # --- C. Defect B: a status-less configuration error is not a timeout ---

  @unit
  Scenario: A configuration error carrying no status code is not classified as a timeout
    Given a provider error with no status code and the message "deployments not set"
    When it is classified
    Then its domain code is not the provider-timeout code
    And the HTTP status surfaced to the client is 502

  @integration
  Scenario: A permanent configuration error is not retried
    Given a provider error with no status code and the message "deployments not set"
    When a dispatch fails with it
    Then the retry reason is non-retryable
    And the credential fallback chain is not walked
    And the circuit breaker for that credential records no failure

  @unit
  Scenario: A genuine provider timeout still classifies as a timeout
    Given an error built by the provider library's own timeout constructor
    When it is classified
    Then its domain code is the provider-timeout code
    And the HTTP status surfaced to the client is 504
    And the retry reason is timeout

  @unit
  Scenario Outline: The remaining status-less error shapes are classified deliberately
    Given an error built by the provider library's <constructor> constructor
    When it is classified
    Then it lands on a named domain code with a named HTTP status
    And that code is not the provider-timeout code

    Examples:
      | constructor            |
      | unsupported operation  |
      | operation failure      |

  @unit
  Scenario Outline: Errors carrying an explicit status keep their current classification
    Given a provider error with status code <status>
    When it is classified
    Then its domain code is <code> and the HTTP status surfaced to the client is <http>

    Examples:
      | status | code             | http |
      | 504    | provider_timeout | 504  |
      | 408    | provider_error   | 502  |
      | 429    | rate_limited     | 429  |
      | 500    | provider_error   | 502  |

  @integration
  Scenario: The operator can identify the cause from the response alone
    Given a dispatch that fails with a status-less "deployments not set" configuration error
    When the client receives the error response
    Then the response body still contains the underlying provider message

  # Not enforced here: two of the four surfaces are the generated cross-language
  # codes and the control-plane TypeScript app, neither reachable from a Go
  # test. The repository's own codegen and typecheck gates hold them.
  @integration @unimplemented
  Scenario: A newly introduced error code moves with all of its coupled surfaces
    Given the fix introduces a new domain error code
    When the change is complete
    Then the code has a registered HTTP status
    And regenerating the cross-language error codes produces no diff
    And the control-plane app typechecks with a customer-facing presentation entry for the code
    And the code is either relayed upstream or the decision not to relay it is stated

# --- AC Coverage Map ---
# The dispatch-path self-map (former AC1, AC3–AC6, AC8, AC11–AC15, AC22–AC25) now
# lives on main via PR #7778 and is covered by
# specs/ai-gateway/azure-endpoint-from-api-base.feature. This file carries only
# the parts unique to this change: the control-plane wire contract, key-alias
# forwarding for every deployment-mapped provider (Vertex included), and the
# config-error classification of Defect B.
#
# AC2:  "Empty {} deployment_map behaves identically to absent" -> Scenario: An empty deployment_map is treated the same as an absent one
# AC7:  "Non-empty wire deployment_map reaches the provider verbatim" -> Scenario: A configured deployment_map reaches the provider verbatim
# AC9:  "Azure, Bedrock and Vertex all forward the deployment map into the key aliases" -> Scenario Outline: Every deployment-mapped provider forwards its deployment map to the key aliases
# AC10: "Non-mapped providers unchanged; nil stays nil" -> Scenario Outline: Providers without deployments are left untouched
# AC16: "Status-less config error is not provider_timeout; surfaces 502" -> Scenario: A configuration error carrying no status code is not classified as a timeout
# AC17: "Status-less config error is non-retryable; no fallback walk, no breaker trip" -> Scenario: A permanent configuration error is not retried
# AC18: "Genuine vendor-constructed timeout still 504 / ReasonTimeout" -> Scenario: A genuine provider timeout still classifies as a timeout
# AC18b:"The other two status-less constructors are classified deliberately" -> Scenario Outline: The remaining status-less error shapes are classified deliberately
# AC19: "True baseline for 504 / 408 / 429 / 500" -> Scenario Outline: Errors carrying an explicit status keep their current classification
# AC20: "Client-visible body still carries the underlying provider message" -> Scenario: The operator can identify the cause from the response alone
# AC21: "New herr.Code moves all four coupled surfaces together (N/A if reused)" -> Scenario: A newly introduced error code moves with all of its coupled surfaces
#
# Enforcement: 10 scenarios are bound to Go tests; AC21 carries @unimplemented
# (codegen and TypeScript surfaces, not reachable from a Go test).

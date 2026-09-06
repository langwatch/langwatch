Feature: Provider runtime security upgrades preserve Azure requests
  The provider runtime uses the fixed Bifrost release for GO-2026-6320.
  Existing Azure credentials keep their API versions and deployment routes.

  @unit
  Scenario: Azure deployment requests retain configured and default API versions
    Given Azure credentials with a model-to-deployment mapping
    When a chat, embedding, speech, or transcription request is dispatched
    Then the request reaches the mapped deployment with the Azure API key
    And an explicit API version is retained
    And an absent API version defaults to "2024-10-21"
    And the response content and usage are preserved

  @unit
  Scenario: Azure chat streams retain role repair and token usage
    Given an Azure chat stream whose first content delta omits its role
    When the gateway forwards the stream
    Then the first delta includes the assistant role
    And the final usage totals reach the caller

  @unit
  Scenario: Azure provider errors preserve native status and body
    Given Azure rejects a request with a provider error
    When the gateway returns the response
    Then the provider status and error body are preserved
    And the retry header is retained

  @unit
  Scenario: Azure chat keeps Claude deployment routing
    Given an Azure model mapped to a Claude deployment
    When a chat request is dispatched
    Then the request uses the Anthropic messages endpoint
    And the normalized response content and usage are preserved

  @unit
  Scenario: Azure stream failures remain visible
    Given an Azure stream that returns an HTTP or SSE error
    When the gateway forwards the stream
    Then the caller receives an error
    And HTTP error status, body, and retry headers are retained

  @unit
  Scenario: Azure passthrough keeps the credential API version
    Given Azure credentials with a configured API version
    When a deployment passthrough request supplies a different API version
    Then the credential API version takes precedence
    And other query parameters are preserved

Feature: Azure api-version override — dedup the drop warning, tell the customer
  Azure non-Claude chat, embeddings, speech and transcription requests use
  versioned deployment endpoints and honor the credential's api-version.
  Passthrough requests use it where the Azure endpoint accepts api-version;
  Responses keeps its required preview version. Native endpoint routing does
  not honor the credential override and warns once per credential, including
  when native key resolution is concurrent. Direct/Studio dispatch continues
  honoring its configured version.

  The settings form explains the endpoint distinction for both Azure API
  version fields, so a customer can tell where the value takes effect.

  Background:
    Given an Azure OpenAI provider whose credential carries a caller-supplied
      api-version override
    And ignored-version warnings are checked on native Azure key resolution

  @unit
  Scenario: Repeated dispatches for one Azure credential warn only once
    When the gateway resolves the Azure credential's bifrost key 3 times for
      the same credential id
    Then exactly one "azure api_version override is ignored" warning is logged
    And that warning still carries the api_version value in its structured
      fields

  @unit
  Scenario: A credential sourced from the /go/proxy header path still warns on first sight
    Given the Azure credential's id was produced by the /go/proxy header
      parsing path rather than the control-plane virtual-key path
    When the gateway resolves that credential's bifrost key for the first time
    Then the "azure api_version override is ignored" warning is logged

  @unit
  Scenario: Two Azure credentials each warn once
    Given a second, distinct Azure credential that also carries an
      api-version override
    When the gateway resolves each credential's bifrost key at least twice
    Then exactly two "azure api_version override is ignored" warnings are
      logged in total, one per credential id

  @unit
  Scenario: A credential with no api-version override never warns
    Given an Azure credential whose api-version field is empty
    When the gateway resolves that credential's bifrost key 3 times
    Then no "azure api_version override is ignored" warning is logged

  @unit
  Scenario: Concurrent dispatches for one credential warn exactly once
    Given 50 or more concurrent goroutines resolving the same Azure
      credential's bifrost key against one shared, long-lived account
    When all of them complete
    Then exactly one "azure api_version override is ignored" warning is
      logged
    And the race detector reports no data race

  @integration
  Scenario: The Azure provider drawer explains which endpoints honor the api-version
    When a customer opens the Azure OpenAI provider settings drawer
    Then the direct-mode api-version field explains that chat except Claude,
      embeddings, speech and transcription honor the value through the AI Gateway
    And it explains that Responses and other endpoint types ignore the value
    And it explains that passthrough honors it where the Azure endpoint supports it
    And the API Management gateway-mode api-version field explains the same thing
    And neither field names an internal service

  @integration
  Scenario: A non-Azure provider drawer shows no api-version note
    When a customer opens a non-Azure provider's settings drawer
    Then no "ignored" api-version note appears

  @unit
  Scenario: Direct-mode Azure dispatch uses the customer's configured api-version
    Given an Azure provider configured for direct dispatch with an explicit
      AZURE_OPENAI_API_VERSION
    When the litellm dispatch parameters are prepared for that provider
    Then the resolved api_version equals the customer's configured value

  @unit
  Scenario: Azure API Management gateway mode defaults its own api-version
    Given an Azure provider configured with an API Management gateway base
      URL and no explicit gateway api-version
    When the litellm dispatch parameters are prepared for that provider
    Then the resolved api_version falls back to the gateway-mode default
    And use_azure_gateway is set

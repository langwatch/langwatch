Feature: `langwatch gemini` wrapper end-to-end
  As a developer running Google Gemini CLI through the LangWatch wrapper
  I want my session authenticated + routed + traced
  So that Gemini sessions get the same governance treatment as the other
  wrappers, with Google as the provider

  Spec maps to Phase 11 (Sergey: P11-per-wrapper).

  Background:
    Given the LangWatch control plane + stub Google Gemini provider are running
    And alice has a default routing policy resolving to the stub Gemini provider
    And alice has an active CLI session

  Scenario: `langwatch gemini` injects Gemini-flavored env vars
    When the harness spawns `langwatch gemini --version`
    Then env contains `GEMINI_API_KEY=lw_vk_<alice's VK>` OR `GOOGLE_API_KEY=lw_vk_<alice's VK>` (per Gemini CLI's accepted env conventions)
    And env contains the gateway base URL via the appropriate Google AI SDK env var

  Scenario: Gemini invocation routes through gateway
    When the harness fires a stubbed Gemini call (`models/gemini-2.5-pro:generateContent`)
    Then the gateway receives the request + routes to stub Gemini provider
    And response carries `gen_ai.system = "google"` + `gen_ai.request.model = "gemini-2.5-pro"`

  Scenario: Trace attribution
    Then spans carry alice's principal_id + organization_id + `personal: true` + `gen_ai.system = "google"`

  Scenario: Token-count accuracy
    Given Google's response shape uses `usageMetadata.promptTokenCount` + `candidatesTokenCount`
    When the gateway extracts the OTel attributes
    Then `gen_ai.usage.input_tokens` matches `promptTokenCount`
    And `gen_ai.usage.output_tokens` matches `candidatesTokenCount`

  Scenario: Wrapper exits with the wrapped binary's exit code
    Given the stubbed `gemini` binary exits with code 2
    Then `langwatch gemini`'s exit code is 2

Feature: Provider request timeout fits slow LLM completions
  As a user running long LLM completions through the gateway
  I want the gateway's upstream request timeout to allow slow models to finish
  So that long evaluations and workflows don't fail with a 504 after 30 seconds

  Background:
    Bifrost's built-in default request timeout is 30 seconds, which long
    completions (reasoning models, large generations) regularly exceed. The
    gateway's longest-running callers are AWS Lambdas hard-capped at 15
    minutes, so the gateway-wide ceiling is 14 minutes: long enough for any
    realistic completion, with a one-minute margin under the caller's cap.

    # Bindings: services/aigateway/adapters/providers/network_config_test.go
    # Sender: services/aigateway/adapters/providers/bifrost.go (account.GetConfigForProvider)

  @unit
  Scenario: Upstream requests get a 14 minute timeout for every provider
    Given the gateway builds the connection configuration for any provider
    When a request is dispatched upstream
    Then the request timeout is 14 minutes instead of the 30 second default

  @unit
  Scenario: Streaming responses tolerate long gaps between chunks
    Given a streaming completion where the model thinks for minutes before the first token
    When the gateway waits for the next chunk
    Then the per-chunk idle timeout matches the same 14 minute ceiling
    # The default 60s idle timeout would kill reasoning-model streams that
    # emit nothing while thinking.

  @unit
  Scenario: Direct embedding requests share the same ceiling
    Given an embeddings request served by the direct (non-routed) client
    When the request is dispatched
    Then its client timeout is the same 14 minute ceiling

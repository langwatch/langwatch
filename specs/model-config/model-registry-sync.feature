@integration
Feature: Model Registry Sync Task
  As a developer maintaining the LLM model catalog
  I want to sync model metadata from an external API
  So that we have up-to-date model information including supported parameters

  Background:
    Given the OPENROUTER_API_KEY environment variable is set

  # Data Fetching
  Scenario: Fetches all models from the API
    When I run the syncModelRegistry task
    Then it should fetch models from the OpenRouter API
    And the response should contain a list of models

  Scenario: Handles API errors gracefully
    Given the API returns an error response
    When I run the syncModelRegistry task
    Then it should log an error message
    And it should exit with a non-zero status code

  # Provider Name Mapping
  Scenario: Maps OpenRouter provider names to litellm format
    Given the API returns models with provider "google"
    When I run the syncModelRegistry task
    Then models should be mapped to provider "gemini"

  Scenario: Preserves provider names that already match
    Given the API returns models with provider "openai"
    When I run the syncModelRegistry task
    Then models should keep provider "openai"

  Scenario: Preserves provider names for anthropic
    Given the API returns models with provider "anthropic"
    When I run the syncModelRegistry task
    Then models should keep provider "anthropic"

  Scenario: Preserves unknown provider names as-is
    Given the API returns models with provider "some-new-provider"
    When I run the syncModelRegistry task
    Then models should keep provider "some-new-provider"
    # Unknown providers are kept for future custom provider matching

  # Data Transformation - Pricing
  Scenario: Transforms basic pricing to cost per token format
    Given the API returns a model with pricing:
      | prompt     | 0.00003 |
      | completion | 0.00006 |
    When I run the syncModelRegistry task
    Then the model should have:
      | inputCostPerToken  | 0.00003 |
      | outputCostPerToken | 0.00006 |

  Scenario: Preserves cache pricing when available
    Given the API returns a model with pricing:
      | prompt            | 0.00003  |
      | completion        | 0.00006  |
      | input_cache_read  | 0.000015 |
      | input_cache_write | 0.0001   |
    When I run the syncModelRegistry task
    Then the model should have pricing:
      | inputCostPerToken      | 0.00003  |
      | outputCostPerToken     | 0.00006  |
      | inputCacheReadPerToken | 0.000015 |
      | inputCacheWritePerToken| 0.0001   |

  Scenario: Preserves image pricing when available
    Given the API returns a model with pricing:
      | prompt       | 0.00003 |
      | completion   | 0.00006 |
      | image        | 0.01    |
      | image_output | 0.02    |
    When I run the syncModelRegistry task
    Then the model should have pricing:
      | inputCostPerToken       | 0.00003 |
      | outputCostPerToken      | 0.00006 |
      | imageCostPerToken       | 0.01    |
      | imageOutputCostPerToken | 0.02    |

  Scenario: Preserves audio pricing when available
    Given the API returns a model with pricing:
      | prompt     | 0.00003 |
      | completion | 0.00006 |
      | audio      | 0.001   |
    When I run the syncModelRegistry task
    Then the model should have pricing:
      | inputCostPerToken  | 0.00003 |
      | outputCostPerToken | 0.00006 |
      | audioCostPerToken  | 0.001   |

  Scenario: Preserves internal reasoning pricing when available
    Given the API returns a model with pricing:
      | prompt             | 0.00003 |
      | completion         | 0.00006 |
      | internal_reasoning | 0.00012 |
    When I run the syncModelRegistry task
    Then the model should have pricing:
      | inputCostPerToken            | 0.00003 |
      | outputCostPerToken           | 0.00006 |
      | internalReasoningCostPerToken| 0.00012 |

  # Data Transformation - Parameters
  Scenario: Extracts supported parameters
    Given the API returns a model with supported_parameters:
      | temperature      |
      | top_p            |
      | max_tokens       |
      | frequency_penalty |
    When I run the syncModelRegistry task
    Then the model should have supportedParameters containing all those parameters

  Scenario: Handles models without supported parameters
    Given the API returns a model without supported_parameters
    When I run the syncModelRegistry task
    Then the model should have an empty supportedParameters array

  Scenario: Extracts context length and max completion tokens
    Given the API returns a model with:
      | context_length       | 128000 |
      | max_completion_tokens | 16384  |
    When I run the syncModelRegistry task
    Then the model should have:
      | contextLength       | 128000 |
      | maxCompletionTokens | 16384  |

  Scenario: Determines mode from modality
    Given the API returns a model with modality "text->text"
    When I run the syncModelRegistry task
    Then the model should have mode "chat"

  Scenario: Identifies embedding models
    Given the API returns a model with modality "text->embedding"
    When I run the syncModelRegistry task
    Then the model should have mode "embedding"

  # Data Transformation - Modality Detection
  Scenario: Detects image input support from input_modalities
    Given the API returns a model with architecture:
      | input_modalities | ["text", "image"] |
    When I run the syncModelRegistry task
    Then the model should have supportsImageInput true

  Scenario: Detects audio input support from input_modalities
    Given the API returns a model with architecture:
      | input_modalities | ["text", "audio"] |
    When I run the syncModelRegistry task
    Then the model should have supportsAudioInput true

  Scenario: Detects image output support from output_modalities
    Given the API returns a model with architecture:
      | output_modalities | ["text", "image"] |
    When I run the syncModelRegistry task
    Then the model should have supportsImageOutput true

  Scenario: Detects audio output support from output_modalities
    Given the API returns a model with architecture:
      | output_modalities | ["text", "audio"] |
    When I run the syncModelRegistry task
    Then the model should have supportsAudioOutput true

  Scenario: Text-only models have no multimodal flags
    Given the API returns a model with architecture:
      | input_modalities  | ["text"] |
      | output_modalities | ["text"] |
    When I run the syncModelRegistry task
    Then the model should have supportsImageInput false
    And the model should have supportsAudioInput false

  # Output
  Scenario: Saves transformed data to JSON file
    When I run the syncModelRegistry task successfully
    Then it should create llmModels.json in langwatch/langwatch/src/server/modelProviders/
    And the JSON should be valid and parseable
    And each model entry should have required fields:
      | id                  |
      | name                |
      | provider            |
      | pricing             |
      | contextLength       |
      | maxCompletionTokens |
      | supportedParameters |
      | modality            |
      | mode                |

  Scenario: Output includes all providers from API
    When I run the syncModelRegistry task
    Then the output should include models from all providers returned by the API
    # All providers are kept, including unknown ones, for future custom provider matching

  # Embedding Models Sync
  Scenario: Fetches embedding models from separate API endpoint
    When I run the syncModelRegistry task
    Then it should fetch models from the OpenRouter /api/v1/models endpoint
    And it should fetch embedding models from the OpenRouter /api/v1/embeddings/models endpoint

  Scenario: Merges chat and embedding models in output
    Given the chat models API returns 300 models
    And the embeddings API returns 50 models
    When I run the syncModelRegistry task
    Then the output should contain 350 total models

  Scenario: Embedding models have mode set to embedding
    When I run the syncModelRegistry task
    Then all models from the embeddings endpoint should have mode "embedding"

  Scenario: Embedding models have correct pricing structure
    Given the embeddings API returns a model with pricing:
      | prompt     | 0.00001 |
      | completion | 0       |
    When I run the syncModelRegistry task
    Then the embedding model should have:
      | inputCostPerToken  | 0.00001 |
      | outputCostPerToken | 0       |

  Scenario: Embedding models are accessible via embedding mode filter
    When I run the syncModelRegistry task
    Then the output should contain models with mode "embedding"
    And those models can be filtered using mode === "embedding"

  Scenario: Handles embeddings API error gracefully
    Given the embeddings API returns an error response
    And the chat models API returns models successfully
    When I run the syncModelRegistry task
    Then it should still include chat models in output
    And it should log a warning about embeddings API failure

  Scenario: Logs embedding model count in stats
    When I run the syncModelRegistry task successfully
    Then the console output should include embedding model count

Feature: Google Agent Platform as a model provider

  Google issues several kinds of credential, and they are not interchangeable.
  A key minted in the Cloud console for Gemini Enterprise Agent Platform is
  refused by generativelanguage.googleapis.com — correctly, since its API
  restrictions exclude that service — so a customer holding one could not add
  Gemini at all. They were told their key was invalid, which it is not.

  Agent Platform is its own service: its own host, its own auth header, and a
  path that names the project and location. That makes it a provider of its
  own, the same way Vertex AI is, rather than a mode of the Gemini one.

  Established by probing a real Agent Platform key, because the two endpoints
  on that host disagree and the documentation does not say so:

    POST .../publishers/google/models/{model}:generateContent  accepts an API key
    GET  .../models                                            401, "API keys are
                                                               not supported by
                                                               this API"

  Validating by listing models — what every other provider here does — would
  therefore report a working credential as unusable.

  @unit
  Scenario: An Agent Platform key is checked against the endpoint that accepts it
    Given a Google Agent Platform provider with an API key, project and location
    When I check the credential
    Then the provider is asked to generate content, not to list its models

  @unit
  Scenario: The credential travels in a header, never in the URL
    Given a Google Agent Platform provider with an API key
    When I check the credential
    Then the key is sent as the x-goog-api-key header
    And the key does not appear in the request URL

  @unit
  Scenario: The project and location the customer gave are the ones probed
    Given a Google Agent Platform provider for project "acme-123" in location "us-central1"
    When I check the credential
    Then the request path names that project and that location

  @unit
  Scenario: A key the platform accepts is valid
    Given Agent Platform answers the generate-content request
    When I check the credential
    Then the credential is reported as valid

  @unit
  Scenario: A key the platform refuses is explained, not just rejected
    Given Agent Platform refuses the credential
    When I check the credential
    Then I am told the key was refused
    And the provider's own sentence is not part of what I am told

  @unit
  Scenario: A model the project cannot reach is not reported as a bad key
    Given Agent Platform answers that the publisher model was not found
    When I check the credential
    Then I am not told the API key is invalid

  @unit
  Scenario: A provider that never answers is not a verdict on the key
    Given Agent Platform cannot be reached
    When I check the credential
    Then the failure says the provider could not be reached

  # A credential re-check that only has the key — the shape produced when a
  # caller rebuilds customKeys from a stored key and drops every other
  # field — must not be treated as though nothing is wrong with the key.
  # There is nothing to probe without a project and location, so this is
  # the same "no verdict" outcome as the provider never answering, not a
  # refusal.
  @unit
  Scenario: A credential missing its project or location is not probed at all
    Given an Agent Platform credential with no project or location
    When I check the credential
    Then the failure says the provider could not be reached
    And nothing was sent to the provider

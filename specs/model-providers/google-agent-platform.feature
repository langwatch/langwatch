Feature: Gemini credentials work through either Google door

  Google sells Gemini through two services, and a key opens exactly one of
  them. An AI Studio key answers on generativelanguage.googleapis.com; a key
  minted for Gemini Enterprise Agent Platform is refused there and answers on
  aiplatform.googleapis.com instead, at a path that names the project and
  location. Same models, same request and response shape, same auth header —
  verified live with one key of each kind, each blocked on the other's host
  with reason API_KEY_SERVICE_BLOCKED.

  So Agent Platform is not its own provider with its own model list: it is a
  second door into the Gemini provider. The customer configures Gemini once,
  with whichever key they hold; which door the key opens is detected, not
  asked. A row whose credential carries a project and location speaks to
  Agent Platform; a row without them speaks to the Gemini API. Model names
  stay `gemini/…` everywhere either way — nothing downstream learns a new
  prefix.

  Established by probing real keys, because the two endpoints disagree and
  the documentation does not say so:

    POST aiplatform…/publishers/google/models/{model}:generateContent  accepts an API key
    GET  aiplatform…/models                                            401, "API keys are
                                                                       not supported by
                                                                       this API"

  Validating Agent Platform by listing models — what every other provider
  here does — would therefore report a working credential as unusable.

  # ── Detecting which door a key opens ────────────────────────────────────

  @unit
  Scenario: An AI Studio key validates through the Gemini API door
    Given a Gemini credential with only an API key
    When I check the credential
    Then the check happens against the Gemini API host

  @unit
  Scenario: An Agent Platform key without project and location is told what is missing, not that it is invalid
    Given a Gemini credential with only an API key
    And the Gemini API refuses it because the key is restricted to another service
    When I check the credential
    Then I am told the key belongs to a different Google service
    And the remediation names the project and location fields

  @unit
  Scenario: A credential carrying project and location is checked through the Agent Platform door
    Given a Gemini credential for project "acme-123" in location "us-central1"
    When I check the credential
    Then the check happens against project "acme-123" in location "us-central1" on the Agent Platform host
    And nothing is sent to the Gemini API host

  @unit
  Scenario: A key Agent Platform accepts is valid
    Given Agent Platform accepts the credential
    When I check the credential through the Agent Platform door
    Then the credential is reported as valid

  # ── Refusals stay explained and customer-safe ───────────────────────────

  @unit
  Scenario: The credential is not exposed where logs or browser history could retain it
    Given a Gemini credential for a project and location
    When I check the credential
    Then the key does not appear in the address used to reach the provider

  @unit
  Scenario: A key the platform refuses is explained, not just rejected
    Given Agent Platform refuses the credential
    When I check the credential through the Agent Platform door
    Then I am told the key was refused
    And the provider's own sentence is not part of what I am told

  @unit
  Scenario: A model the project cannot reach is not reported as a bad key
    Given Agent Platform answers that the publisher model was not found
    When I check the credential through the Agent Platform door
    Then I am not told the API key is invalid

  @unit
  Scenario: A provider that never answers is not a verdict on the key
    Given Agent Platform cannot be reached
    When I check the credential through the Agent Platform door
    Then the failure says the provider could not be reached

  # ── Dispatch follows the credential, models stay gemini/* ───────────────

  @unit
  Scenario: A Gemini row with a project and location sends traffic through the Agent Platform door
    Given an enabled Gemini provider whose credential carries a project and location
    When the gateway materialises the credential
    Then the credential carries the project and the location as the region
    And the model names offered to the customer are unchanged Gemini catalog names

  @unit
  Scenario: A Gemini row without a project sends traffic through the Gemini API door
    Given an enabled Gemini provider whose credential is only an API key
    When the gateway materialises the credential
    Then the credential carries no project and no region

  # The Agent Platform door serves chat but not embeddings (verified live:
  # the embeddings endpoint answers 404 on that host). Offering a model
  # that cannot run recreates the picks-it-always-fails defect this whole
  # feature exists to remove.
  @unit
  Scenario: Embedding models are not offered through a door that cannot serve them
    Given the only enabled Gemini credential carries a project and location
    When the customer opens an embedding model picker
    Then the Gemini embedding models are not offered
    And a Gemini credential without the pair makes them available again

  # ── The old separate provider folds in ──────────────────────────────────

  @unit
  Scenario: A stored Google Agent Platform row becomes a Gemini row with the same credential
    Given a stored model provider row for Google Agent Platform with a key, project and location
    When the fold-in migration runs
    Then the row's provider is Gemini
    And its key, project and location are preserved under the Gemini field names
    And its scope and enabled state are unchanged

  # A green check on a key that was never probed is worse than no check:
  # the fold-window row keeps its retired provider name, and nothing about
  # that name may quietly disable the walk to the Agent Platform door.
  @unit
  Scenario: A legacy row still validates through the Agent Platform door during the fold window
    Given a stored Google Agent Platform row with a key, project and location
    When I check the credential
    Then the check happens against the Agent Platform host
    And the credential is not reported as valid without a request being made

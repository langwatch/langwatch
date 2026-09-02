Feature: Gateway image endpoints, OpenAI-compatible generation and editing
  As a developer building an image feature on top of a virtual key
  I want the gateway to serve /v1/images/generations and /v1/images/edits
  So that image traffic gets the same governance, observability and cost tracking as chat
  And so pointing an OpenAI SDK's base_url at the gateway is all an image app needs to change

  # The contract (§3) has declared the generation route since v0.1: this feature
  # makes it real and adds the edit route beside it. Bifrost v1.4.22 (already
  # pinned) ships ImageGenerationRequest and ImageEditRequest, so no Bifrost
  # upgrade is required. Both routes are non-streaming.

  Background:
    Given the gateway is running with a control plane
    And a virtual key "vk-lw-test" bound to an organization with an OpenAI API key configured

  # ============================================================
  # Group: Image generation (POST /v1/images/generations)
  # ============================================================

  @integration
  Scenario: OpenAI-shape image generation returns the images JSON
    When the client POSTs /v1/images/generations with the OpenAI wire shape
      | field   | value                  |
      | model   | openai/gpt-image-2     |
      | prompt  | a red bicycle          |
      | size    | 1024x1024              |
      | quality | low                    |
      | n       | 1                      |
    Then the response is 200 with the OpenAI images JSON
    And data[0].b64_json carries the base64 image, which is what every OpenAI SDK reads
    And an OpenAI SDK's `client.images.generate(...)` consumes it unchanged

  @unit
  Scenario: response_format is forwarded only when the caller sent it
    When the client sends no response_format
    Then the gateway sends none either
    # The gpt-image family rejects the field outright and dall-e-3 needs it, so
    # inventing a value breaks one model or the other.

  @unit
  Scenario: A bare model name resolves like chat models do
    When the client sends model "gpt-image-2" with no provider prefix
    Then model resolution applies the virtual key's aliases and allowlist exactly as /v1/chat/completions does
    And the explicit "provider/model" form bypasses aliases, as everywhere else

  # ============================================================
  # Group: Image editing (POST /v1/images/edits)
  # ============================================================

  @integration
  Scenario: The OpenAI SDK's image[] parts carry every source image
    When the client POSTs /v1/images/edits as multipart/form-data
      | part    | value                       |
      | image[] | <the first source PNG>      |
      | image[] | <the second source PNG>     |
      | prompt  | put the bicycle on a beach  |
      | model   | openai/gpt-image-2          |
    Then every source image reaches the provider, in the order the client sent them
    And the response is 200 with the same images JSON the generation route returns

  @unit
  Scenario: A single image posted under the singular field is accepted
    When the form carries one file under "image" instead of "image[]"
    Then the gateway accepts it as the single source image
    # curl and a caller writing the request by hand use the singular name; the
    # OpenAI Node SDK always sends the plural one.

  @unit
  Scenario: A multipart edit with no image part fails informatively
    When the form has a model and a prompt but no image part
    Then the gateway responds 400 naming the missing "image" field
    And no provider is contacted

  @unit
  Scenario: A multipart edit with no prompt fails informatively
    When the form has a model and an image but no prompt part
    Then the gateway responds 400 naming the missing "prompt" field
    And no provider is contacted

  @unit
  Scenario: Oversized image uploads are rejected before provider dispatch
    Given a multipart upload larger than the image edit size cap
    When the request is parsed
    Then the gateway responds 413 without contacting any provider

  @unit
  Scenario: Only the allowlisted text fields reach the provider
    When the form carries a field the OpenAI wire does not define
    Then that field is dropped rather than forwarded blind
    And prompt, n, size, quality, background, input_fidelity, output_format,
      output_compression, response_format and user are forwarded

  # ============================================================
  # Group: Streaming
  # ============================================================

  @unit
  Scenario: A streamed image request is refused before dispatch
    When the client sends "stream": true, or partial_images above zero, on either route
    Then the gateway responds 400 saying streaming image generation is not supported
    And no provider is contacted
    # Both routes answer with one JSON body. A caller left waiting for
    # partial-image events would wait for frames that never come.

  # ============================================================
  # Group: Credentials
  # ============================================================

  @unit
  Scenario: An OpenAI credential with a custom base URL is refused with a readable message
    Given a virtual key whose OpenAI credential carries a base_url override
    When the client calls either image route
    Then the response names the credentials that do serve images
    # Such a credential routes to the OpenAI-compatible generic provider, which
    # answers every image call with an unsupported-operation error.

  # ============================================================
  # Group: Metering and observability
  # ============================================================

  @unit
  Scenario: A span states its image tokens apart from its text tokens
    When an image call reports input and output token details
    Then the image tokens are taken out of the prompt and completion totals
    And the span carries gen_ai.usage.input_image_tokens, gen_ai.usage.output_image_tokens
      and gen_ai.usage.image_count
    # An output image token costs about four times a text one. Pricing a flat
    # total at the text rate charges a fraction of the real call.

  @unit
  Scenario: An image span carries the prompt and never the pixels
    When the trace emitter renders an image call
    Then the input message is the prompt, rendered as one user turn
    And the output message is empty, or the model's revised prompt when it states one
    # The response body is megabytes of base64 pixels, which must never land on
    # a span.

  @unit
  Scenario: An image call attributes its end user like chat does
    When the caller sends the OpenAI "user" field on either route
    Then spend attribution and the customer span both resolve that end user
    # The edit route is multipart, so the gateway synthesizes a small JSON body
    # carrying the model, the prompt and the user for the pipeline stages that
    # read one.

  @integration
  Scenario: An image call is metered and billed
    When the client generates an image and then edits it through the gateway
    Then both spend records carry the image token counts
    And both traces land with a cost above zero

  # ============================================================
  # Group: Governance (the same pipeline as chat)
  # ============================================================

  @unit
  Scenario: Image requests authenticate exactly like chat
    When a request carries no virtual key, or a revoked one
    Then the response is the same 401 the chat endpoint returns

  @unit
  Scenario: The virtual key's model allowlist applies
    Given a virtual key whose models_allowed does not include the requested image model
    When the client calls either image endpoint with that model
    Then the request is rejected with the standard model_not_allowed error

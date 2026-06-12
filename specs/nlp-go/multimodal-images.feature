Feature: Image inputs reach the LLM as image content parts
  As a user running vision workflows and evaluations
  I want image fields referenced in my prompt to reach the model as images
  So that the model actually sees the picture instead of a wall of base64 text

  Background:
    Dataset image columns carry data URLs (data:image/...;base64,...). The
    prompt template interpolates them into message text, so without splitting,
    the model receives the base64 bytes as literal text inside one message and
    can only guess. The Python engine split text-with-image into OpenAI
    multimodal content parts (text part, image part, text part); the Go engine
    must do the same. Everything downstream (executor filtering, the gateway,
    providers) already forwards content-part arrays untouched.

    # Bindings: services/nlpgo/app/engine/multimodal_test.go
    # Split: services/nlpgo/app/engine/multimodal.go (runSignature applies it
    # to the messages buildMessages returns)

  @unit
  Scenario: A message with an image in the middle becomes text and image parts
    Given a user message whose text contains an image data URL between two sentences
    When the engine builds the LLM messages
    Then the message content becomes a parts list of text, image, text
    And the image part carries the full data URL untouched

  @unit
  Scenario: An uppercase BASE64 data URL is split into image parts
    Given a user message whose image data URL spells the scheme, media type and base64 token in uppercase
    When the engine builds the LLM messages
    Then the content still becomes text and image parts
    # RFC 2397 allows uppercase in the scheme, media type, and ";base64" token.

  @unit
  Scenario: Multiple images in one message each become their own image part
    Given a user message referencing two image fields
    When the engine builds the LLM messages
    Then the content carries two image parts in their original positions

  @unit
  Scenario: Messages without images are left untouched
    Given a user message with plain text only
    When the engine builds the LLM messages
    Then the message content stays a plain string

  @unit
  Scenario: An image interpolated into the system prompt moves to a user message
    Given the prompt template places an image field inside the instructions
    When the engine builds the LLM messages
    Then the system message keeps only the text before the image
    And a user message right after carries the image and surrounding text as parts
    # Providers reject image parts in system-role messages, so an image that
    # lands in the instructions must be re-homed or the request fails anyway.

  @unit
  Scenario: Adjacent images produce no empty text parts
    Given a message whose text is exactly two image data URLs back to back
    When the engine builds the LLM messages
    Then the content carries exactly two image parts and no empty text parts

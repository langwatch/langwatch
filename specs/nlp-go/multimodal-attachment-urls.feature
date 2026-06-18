Feature: Remote attachment URLs are fetched and delivered to the model as content
  As a user running vision and multimodal workflows and evaluations
  I want an attachment referenced by a plain http(s) URL to reach the model as
  real content, not as the literal URL text
  So that the model actually sees the picture (or hears the audio, reads the
  document) instead of guessing from a link it cannot open

  Background:
    Today an image only reaches the model when its value is an inline
    data:image/...;base64,... URL; that base64 case is split into content parts
    by the existing image splitter. A value that is a plain http(s) URL is
    interpolated into the message as text and the model never sees the content.
    The engine should instead fetch a referenced URL, detect its type from the
    response, and deliver it as the right kind of content part so it works
    across every provider, regardless of whether the provider can fetch URLs
    itself. When a referenced attachment cannot be fetched, the run must fail
    with a clear, user-facing message rather than silently sending a broken
    request or a wall of URL text.

    # Bindings: services/nlpgo/app/engine/attachment_test.go and
    # services/nlpgo/tests/integration/attachment_url_test.go
    # Fetch + detect + structure: services/nlpgo/app/engine/attachment.go,
    # applied to the messages buildMessages returns, right beside the existing
    # data-URL image split in multimodal.go.

  # ============================================================================
  # Fetching an image referenced by URL
  # ============================================================================

  @integration
  Scenario: An image referenced by an http URL is fetched and delivered as an image part
    Given a user message whose text is an http URL pointing at a PNG image
    When the engine builds the LLM messages
    Then the message content becomes a parts list carrying an image part
    And the image part carries the fetched image, not the original link text

  @integration
  Scenario: The attachment type is detected from the response, not the file extension
    Given a user message whose http URL has no file extension but serves a JPEG
    When the engine builds the LLM messages
    Then the content still carries an image part for that attachment

  @unit
  Scenario: An image already given as a base64 data URL is delivered without fetching
    Given a user message whose image is an inline base64 data URL
    When the engine builds the LLM messages
    Then the image reaches the model without any network fetch
    # The existing data-URL split keeps working untouched; only http(s) URLs are fetched.

  @integration
  Scenario: Several attachment URLs in one message each become their own part
    Given a user message referencing two image URLs around some text
    When the engine builds the LLM messages
    Then the content carries an image part for each, in their original positions

  @integration
  Scenario: An attachment URL in the system prompt is re-homed to a user message
    Given the system prompt references an image by URL
    When the engine builds the LLM messages
    Then the system message keeps only the text before the image
    And the image is delivered in a user message instead
    # Providers reject image parts in system-role messages.

  # ============================================================================
  # Clear failures when an attachment cannot be fetched
  # ============================================================================

  @integration
  Scenario: An unreachable attachment URL fails the run with a clear message naming the URL
    Given a user message referencing an attachment URL that cannot be reached
    When the engine builds the LLM messages
    Then the run fails with a clear error that names the URL and the reason
    And no request is sent to the model

  @integration
  Scenario: An attachment URL that responds with an error status fails the run clearly
    Given a user message referencing an attachment URL that returns a not-found status
    When the engine builds the LLM messages
    Then the run fails with a clear error that names the URL and the status

  @integration
  Scenario: An attachment larger than the allowed size is rejected with a clear message
    Given a user message referencing an attachment URL whose body exceeds the size limit
    When the engine builds the LLM messages
    Then the run fails with a clear error explaining the attachment was too large
    And no request is sent to the model

  # ============================================================================
  # A plain link the author is only mentioning is left alone
  # ============================================================================

  @integration
  Scenario: A link to a normal web page is left as text, not turned into an attachment
    Given a user message referencing a URL that serves an HTML page
    When the engine builds the LLM messages
    Then the URL is left in the message as text
    And no attachment part is created for it
    # A reachable, non-attachment response (a web page) is the author referencing
    # a link, not attaching a file, so it must not be force-attached.

  # ============================================================================
  # Forward-looking: arbitrary attachment types pass through structured
  # ============================================================================

  @integration
  Scenario: An audio attachment referenced by URL reaches the model as audio
    Given a user message whose http URL points at an audio file
    When the engine builds the LLM messages
    Then the content carries an audio attachment part for the model to hear

  @integration
  Scenario: A PDF attachment referenced by URL reaches the model as a document
    Given a user message whose http URL points at a PDF document
    When the engine builds the LLM messages
    Then the content carries a document attachment part for the model to read

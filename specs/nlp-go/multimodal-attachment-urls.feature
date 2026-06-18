Feature: Remote attachment URLs are fetched and delivered to the model as content
  As a user running vision and multimodal workflows and evaluations
  I want an attachment referenced by a plain http(s) URL to reach the model as
  real content, not as the literal URL text
  So that the model actually sees the picture (or hears the audio, reads the
  document) instead of guessing from a link it cannot open

  Background:
    Today an image reaches the model only when its value is an inline
    data:image/...;base64,... URL; a value that is a plain http(s) URL is passed
    along as text and the model never sees the content. Instead, a referenced
    URL should be fetched, its type detected from the response, and delivered as
    the right kind of content so it works across every provider, regardless of
    whether the provider can fetch URLs itself. When a referenced attachment
    cannot be fetched, the run must fail with a clear, user-facing message
    rather than silently sending a broken request or a wall of URL text.

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
    Given a prompt that references an image by an http URL to a PNG
    When I run the workflow
    Then the model receives the fetched image as a picture, not the link text

  @integration
  Scenario: The attachment type is detected from the response, not the file extension
    Given a prompt referencing an image URL that has no file extension but serves a JPEG
    When I run the workflow
    Then the model still receives it as an image

  @unit
  Scenario: An image already given as a base64 data URL is delivered without fetching
    Given a prompt whose image is already an inline base64 data URL
    When I run the workflow
    Then the model receives the image with no network fetch
    # The existing data-URL handling keeps working untouched; only http(s) URLs are fetched.

  @integration
  Scenario: Several attachment URLs in one message each become their own part
    Given a prompt referencing two image URLs around some text
    When I run the workflow
    Then the model receives both images, each in the position it was mentioned

  @integration
  Scenario: An image mentioned in the system prompt still reaches the model
    Given workflow instructions that reference an image by URL
    When I run the workflow
    Then the model still receives that image as a picture
    And the instructions are kept

  # ============================================================================
  # Clear failures when an attachment cannot be fetched
  # ============================================================================

  @integration
  Scenario: An unreachable attachment URL fails the run with a clear message naming the URL
    Given a prompt referencing an attachment URL that cannot be reached
    When I run the workflow
    Then the run fails with a clear error that names the URL and the reason
    And nothing is sent to the model

  @integration
  Scenario: An attachment URL that responds with an error status fails the run clearly
    Given a prompt referencing an attachment URL that returns a not-found status
    When I run the workflow
    Then the run fails with a clear error that names the URL and the status

  @integration
  Scenario: An attachment larger than the allowed size is rejected with a clear message
    Given a prompt referencing an attachment URL whose body exceeds the size limit
    When I run the workflow
    Then the run fails with a clear error explaining the attachment was too large
    And nothing is sent to the model

  @integration
  Scenario: An attachment URL that redirects to a private address is refused
    Given a prompt referencing an attachment URL that redirects to a private address
    When I run the workflow
    Then the run fails rather than fetching the private address
    # The SSRF policy is re-applied at dial time, so a redirect cannot escape it.

  # ============================================================================
  # A plain link the author is only mentioning is left alone
  # ============================================================================

  @integration
  Scenario: A link to a normal web page is left as text, not turned into an attachment
    Given a prompt referencing a link to a normal web page
    When I run the workflow
    Then the link reaches the model as text
    And no attachment is created for it
    # A reachable, non-attachment response (a web page) is the author referencing
    # a link, not attaching a file, so it must not be force-attached.

  @integration
  Scenario: A broken link in prose does not fail the run
    Given a prompt whose text mentions a link that cannot be reached
    When I run the workflow
    Then the link reaches the model as text
    And the run is not failed by the broken link
    # A bare URL in prose is best-effort; only an explicit image attachment that
    # cannot be fetched fails the run.

  # ============================================================================
  # An image-TYPED field is an explicit attachment, not a best-effort link
  # ============================================================================
  # The studio lets an author declare an input as an Image. That is an explicit
  # statement of intent: the value is a picture, not prose that happens to carry
  # a link. So an image-typed field is resolved up front and fails the run with a
  # clear error when its URL cannot be loaded as an image, rather than being
  # passed to the model as text for it to guess from (e.g. from a filename).

  @integration
  Scenario: An image-typed field whose URL is an image is fetched and inlined
    Given a workflow input declared as an image whose value is an http URL to a picture
    When I run the workflow
    Then the model receives the fetched image, not the link text

  @integration
  Scenario: An image-typed field whose URL cannot be fetched fails the run with a clear error
    Given a workflow input declared as an image whose URL cannot be reached
    When I run the workflow
    Then the run fails with a clear error that names the URL
    And nothing is sent to the model
    # Contrast with the best-effort prose link above: the explicit image field
    # must not silently degrade to the model guessing from the URL text.

  @integration
  Scenario: An image-typed field whose URL is not an image fails the run with a clear error
    Given a workflow input declared as an image whose URL serves a web page
    When I run the workflow
    Then the run fails with a clear error explaining it could not be loaded as an image

  # ============================================================================
  # Forward-looking: arbitrary attachment types pass through structured
  # ============================================================================

  @integration
  Scenario: An audio attachment referenced by URL reaches the model as audio
    Given a prompt whose http URL points at an audio file
    When I run the workflow
    Then the model receives it as audio to hear

  @integration
  Scenario: A PDF attachment referenced by URL reaches the model as a document
    Given a prompt whose http URL points at a PDF document
    When I run the workflow
    Then the model receives it as a document to read

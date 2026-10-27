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

    # Bindings: services/nlpgo/app/engine/attachment_test.go and the live
    # integration probe services/nlpgo/tests/integration/workflow_llm_vision_url_e2e_test.go
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

  # ============================================================================
  # The size limit follows the organization that owns the run
  # ============================================================================
  #
  # The per-file limit is 20 MB unless the organization holds a raised one. The
  # application resolves the organization's limit and names it on each request
  # (`max_attachment_bytes` in the payload, or the
  # X-LangWatch-Max-Attachment-Bytes header), so the engine applies it to that
  # run only.

  @integration
  Scenario: An attachment over the default size is fetched when the request raises the limit
    Given a run whose request names a per-file limit above the default
    And a prompt referencing an attachment URL larger than the default limit but within the named one
    When I run the workflow
    Then the attachment is delivered to the model

  @integration
  Scenario: A request that lowers the limit refuses an attachment the default would accept
    Given a run whose request names a per-file limit below the default
    And a prompt referencing an attachment URL larger than the named limit
    When I run the workflow
    Then the run fails with a clear error explaining the attachment was too large

  @integration
  Scenario: A request that names no limit runs under the default limit
    Given a run whose request names no per-file limit
    And another run on the same engine that named a lower limit
    When I run the workflow with an attachment the default limit accepts
    Then the attachment is delivered to the model

  @unit
  Scenario: A requested limit above what an organization can hold is clamped
    Given a request naming a per-file limit above 1 GB
    When the engine resolves the limit for the run
    Then the run fetches attachments under a 1 GB limit

  @integration
  Scenario: The too-large error names the limit the run was under
    Given a run whose request names a per-file limit of 1 MB
    And a prompt referencing an attachment URL whose body exceeds 1 MB
    When I run the workflow
    Then the error says the attachment is larger than the 1 MB attachment limit

  @unit
  Scenario: The limit is read from the request payload
    Given a run request whose payload carries a per-file limit
    When the engine decodes the request
    Then the run uses the limit from the payload

  @unit
  Scenario: The limit falls back to the request header when the payload names none
    Given a run request whose payload carries no per-file limit
    And the request carries the limit in its header
    When the engine decodes the request
    Then the run uses the limit from the header
    And a header value that is not a positive whole number is ignored

  @integration
  Scenario: A nested workflow run keeps the limit of the run that started it
    Given a run whose request names a per-file limit
    When a node in that run calls another workflow or an evaluator through the application
    Then the call carries the same limit for the nested run

  @unit
  Scenario: The request body limit fits a dataset row with ten inline images
    Given a dataset row carrying ten inline images at the default per-file limit
    When the row is sent to the engine as one request
    Then the engine reads the whole request body

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

  # ============================================================================
  # What the trace records
  # ============================================================================
  # The engine may fetch an attachment far larger than a span can carry: the
  # fetch ceiling is 20 MB and the collector refuses an OTLP body over 10 MB, so
  # a copy of the messages is summarized before it becomes span content. That
  # guard was written for the 20 MB case but applied to every attachment at any
  # size, which cost the trace a 2 KB thumbnail for no benefit and left the
  # reader a placeholder that renders as broken media.
  #
  # So the summary is now a last resort, sized against the collector's body
  # limit rather than the fetch ceiling. An attachment that fits reaches the
  # trace as real content and the ingestion edge externalizes it to the
  # content-addressed store like any other SDK's media
  # (specs/trace-processing/trace-media-blob-extraction.feature). Only the
  # provider call was ever built from the unsummarized messages; that does not
  # change, so what the model sees is unaffected either way.

  @unit
  Scenario: An attachment small enough to carry reaches the trace as real content
    Given a prompt whose image is a data URL well under the traced-content budget
    When I run the workflow
    Then the span's recorded input carries the image content itself
    And the model receives exactly the same image

  @unit
  Scenario: An attachment too large to carry keeps a summary naming its type and size
    Given a prompt whose attachment is larger than the traced-content budget
    When I run the workflow
    Then the span's recorded input carries a summary naming the media type and byte count
    And the model still receives the whole attachment

  @unit
  Scenario: The budget counts every attachment in the message, not each one alone
    Given a prompt carrying several attachments that each fit but together exceed the budget
    When I run the workflow
    Then the attachments are carried in order until the budget is spent
    And the remainder keep their summaries, so the span stays under the collector's body limit

  @unit
  Scenario: Audio and documents follow the same budget as images
    Given a prompt carrying a small audio recording and a small PDF
    When I run the workflow
    Then both reach the trace as real content rather than as summaries

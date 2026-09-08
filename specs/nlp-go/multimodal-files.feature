Feature: File attachments reach the LLM as the content part their type calls for
  As a user who maps a dataset file column to a prompt input
  I want the file to reach the model as a real attachment
  So that the model reads the document, hears the recording or reads the text,
  instead of receiving a wall of base64 characters

  Background:
    A file cell holds a LangWatch file reference, an external URL, or an inline
    data URL. The application resolves a LangWatch reference into a data URL
    before it dispatches the run, and adds the file name as an RFC 2397
    parameter: data:<media type>;name=<url-encoded name>;base64,<payload>.
    Images keep the plain data:image/...;base64,... form they always had.

    The template interpolates that value into the message text, so the engine
    must split it out of the text and deliver it as the content part the media
    type calls for: image_url for a picture, input_audio for a recording, a
    text part for a text document, and a file part for everything else.

    # Bindings: services/nlpgo/app/engine/multimodal_test.go and
    # services/nlpgo/app/engine/attachment_test.go
    # Split by media type: services/nlpgo/app/engine/multimodal.go
    # Fetch of file-typed inputs: services/nlpgo/app/engine/attachment.go

  # ==========================================================================
  # A data URL in the message text becomes the right content part
  # ==========================================================================

  @unit
  Scenario: A PDF data URL in a message becomes a file part with its file name
    Given a user message whose text carries a PDF data URL named "quarterly-report.pdf"
    When the engine builds the LLM messages
    Then the message content becomes a parts list with a file part
    And the file part carries the file name "quarterly-report.pdf"
    And the file part carries the PDF bytes as a data URL without the name parameter
    # The name travels in the filename field, so repeating it inside the data
    # URL only adds bytes the provider must parse.

  @unit
  Scenario: An audio data URL becomes an input_audio part
    Given a user message whose text carries a WAV data URL
    When the engine builds the LLM messages
    Then the message content carries an input_audio part
    And the audio part carries the base64 payload and the format "wav"

  @unit
  Scenario: A text file data URL is delivered as text with its file name
    Given a user message whose text carries a CSV data URL named "sales.csv"
    When the engine builds the LLM messages
    Then the file becomes a text part that starts with the file name
    And the text part carries the decoded file content
    # A text document costs nothing to read as text and every provider accepts
    # it, so there is no reason to send it as an opaque attachment.

  @unit
  Scenario: A text file with bytes that are not valid text is delivered as a file part
    Given a user message whose text carries a data URL of type text/plain whose bytes are not valid UTF-8
    When the engine builds the LLM messages
    Then the message content carries a file part, not a text part
    # The declared media type can be wrong. Decoding it into the prompt would
    # put unreadable characters in front of the model.

  @unit
  Scenario: An unknown binary type is delivered as a file part
    Given a user message whose text carries a data URL of type application/octet-stream
    When the engine builds the LLM messages
    Then the message content carries a file part
    And the file part keeps the media type in its data URL

  @unit
  Scenario: A data URL with no name gets a name from its media type
    Given a user message whose text carries a PDF data URL with no name parameter
    When the engine builds the LLM messages
    Then the file part is named "attachment.pdf"

  @unit
  Scenario: An image data URL still becomes an image part
    Given a user message whose text carries a PNG data URL with a name parameter
    When the engine builds the LLM messages
    Then the message content carries an image_url part
    And the image URL drops the name parameter
    # Providers parse the data URL themselves, so it must stay in the plain
    # form they all accept.

  @unit
  Scenario: A system message carrying a file is split so the file rides in a user message
    Given the prompt template places a PDF data URL inside the instructions
    When the engine builds the LLM messages
    Then the system message keeps only the text before the file
    And a user message right after carries the file part
    # Providers refuse a file part in a system-role message.

  # ==========================================================================
  # A file-typed input that holds a remote URL
  # ==========================================================================

  @integration
  Scenario: A file-typed input holding a remote URL is fetched and delivered by its content type
    Given a workflow input declared as a file whose value is an http URL to a PDF
    When I run the workflow
    Then the model receives the fetched document, not the link text
    And the document keeps the file name from the URL path

  @integration
  Scenario: A file-typed input accepts any content type
    Given a workflow input declared as a file whose URL serves a web page
    When I run the workflow
    Then the page is delivered as a file, and the run is not failed
    # The author declared the field a file, so whatever the URL serves is the
    # file they meant to attach.

  @integration
  Scenario: An image-typed input holding a remote non-image still fails the run
    Given a workflow input declared as an image whose URL serves a web page
    When I run the workflow
    Then the run fails with a clear error explaining it could not be loaded as an image
    # An image field keeps its stricter rule: the author promised a picture.

  # ==========================================================================
  # What the trace records
  # ==========================================================================

  @unit
  Scenario: A large inlined text file keeps a summary in the trace
    Given a message carrying a text attachment larger than the traced-content budget
    When the span records the messages
    Then the recorded text is a summary naming its byte count
    And the model still receives the whole text

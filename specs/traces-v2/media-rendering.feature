Feature: Media rendering across trace surfaces
  Trace message content can carry media parts — audio recordings, images,
  video, and file attachments such as PDFs — either as externalized
  /api/files references (after ingest-side extraction) or as inline data
  URIs. Every surface that shows trace input/output must render these as
  real media, never as raw base64 dumps.

  # Renderer vocabulary (one component, every surface): the simulations
  # MediaPart renders audio as an inline player, images inline (constrained
  # height), video as an inline player, and other files (PDF, csv, ...) as a
  # download/open chip carrying the filename. Trace surfaces reuse it through
  # the TraceAudioPart-style adapters rather than growing their own widgets.
  # Audio specifics are covered by
  # specs/trace-processing/audio-player-in-traces.feature — this feature
  # extends the same contract to images, video, and files, and to the
  # externalized-reference form of all media kinds.

  Background:
    Given a trace whose message content carries media parts

  # ===========================================================================
  # Trace drawer — span input/output
  # ===========================================================================

  @integration
  Scenario: The drawer chat view renders an externalized image inline
    Given a message part {type:"image_url", image_url:{url:"/api/files/{projectId}/{id}"}}
    When I open the trace drawer conversation view
    Then the message shows the image inline instead of the JSON part

  @integration
  Scenario: The drawer chat view renders a PDF attachment as a file chip
    Given a message part {type:"binary", mimeType:"application/pdf", url:"/api/files/{projectId}/{id}", filename:"report.pdf"}
    When I open the trace drawer conversation view
    Then the message shows an attachment chip named "report.pdf" that opens the file

  @integration
  Scenario: The drawer plays an externalized pcm16 recording
    Given a message part {type:"input_audio", input_audio:{url:"/api/files/{projectId}/{id}", mimeType:"audio/pcm16"}}
    When I open the trace drawer conversation view
    Then an audio player is shown and the raw PCM bytes are wrapped for playback on the client

  @integration
  Scenario: Media inside a typed-raw JSON string still renders as media
    Given a span input of shape {type:"raw", value:"<JSON string of messages with a media part>"}
    When I open the span in the drawer
    Then the media part is detected through the nested JSON string
    And rendered with its media widget alongside the text content

  @integration
  Scenario: The legacy input/output view surfaces images and attachments
    Given a span input carrying an externalized image and a PDF attachment
    When I open the trace in the legacy input/output view
    Then an inline image preview and an attachment chip are shown above the raw value

  # ===========================================================================
  # Trace list
  # ===========================================================================

  @integration
  Scenario: The trace list shows a tiny thumbnail when the root input carries an image
    Given a trace whose root input contains an image part
    When I view the traces table
    Then the input preview cell leads with a small thumbnail of the image
    And the text preview still renders next to it

  @integration
  Scenario: The trace list marks audio and attachments without inflating the row
    Given a trace whose root input contains an audio recording
    When I view the traces table
    Then the input preview cell shows a compact audio indicator instead of base64 text

  # ===========================================================================
  # Conversation / messages view
  # ===========================================================================

  @integration
  Scenario: The conversation view renders media parts inside message bubbles
    Given a thread whose messages carry an externalized image and audio part
    When I open the conversation view
    Then each message bubble renders its image inline and its audio with a player

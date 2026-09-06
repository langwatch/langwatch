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

  @unit
  Scenario: A message carrying only media is still the user speaking
    Given a user message whose content is an image and nothing else
    When the drawer groups the messages into turns
    Then the message is a user turn, labelled and iconed as the user
    # A user-role message with no text is folded into the assistant chain,
    # because that is how Anthropic echoes a tool result back. Sending a picture
    # with no caption produces the same shape and is the opposite thing, so the
    # fold now asks what the blocks ARE (tool result, tool call, reasoning)
    # rather than what they are missing.

  @unit
  Scenario: A tool result echoed through the user role still folds into the assistant chain
    Given a user message whose content is only tool results
    When the drawer groups the messages into turns
    Then it folds into the preceding assistant turn, as it does today

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
    Then the input preview cell shows the text preview first
    And a small thumbnail of the image renders below the text, matching the drawer's text-then-media order

  @integration
  Scenario: The trace list shows the thumbnail when only a child span carries the image
    Given a trace whose root span sets the headline text and whose child model call carries the image
    When I view the traces table
    Then the input preview cell still shows the thumbnail below the text
    # This is the shape every framework integration produces: a wrapper span
    # names the trace and the model call underneath it holds the picture.

  @integration
  Scenario: The trace list marks audio and attachments without inflating the row
    Given a trace whose root input contains an audio recording
    When I view the traces table
    Then the input preview cell shows a compact audio indicator instead of base64 text

  # ===========================================================================
  # Conversation thread: media hangs off the message that carried it
  # ===========================================================================
  # The thread layout gives each role its own full-width row, so a turn's media
  # belongs to a message, not to the turn as a whole: what the caller sent
  # renders under the user message and what the agent replied under the
  # assistant message. Which side a part belongs to follows the same rule as
  # the trace summary strips, so a voice turn never shows the caller's
  # recording twice.
  #
  # A turn's own input and output text is flattened at fold time, so the
  # fold-derived media references are what the thread reads; a turn handed over
  # with its raw payload (a threadless trace fetched on its own) is walked for
  # media parts instead. The side bubbles layout renders no media yet, which the
  # unimplemented scenario below keeps visible rather than leaving as an aside.

  @integration
  Scenario: A recording the caller sent renders under the user message
    Given a turn whose media was recorded on the user's message
    When I read the turn in the conversation thread
    Then the user message renders a player for it
    And the assistant message renders no media

  @integration
  Scenario: A recording the agent replied with renders under the assistant message
    Given a turn whose media was recorded on the assistant's message
    When I read the turn in the conversation thread
    Then the assistant message renders a player for it
    And the user message renders no media

  @integration
  Scenario: Media with no role recorded renders on the side it was recorded under
    Given a turn whose input and output each carry media with no role, as turns
      ingested before roles were recorded do
    When I read the turn in the conversation thread
    Then the user message renders the input's media
    And the assistant message renders the output's media

  @integration
  Scenario: A message hidden by a privacy rule renders no media
    Given a turn whose input was hidden from this viewer by a privacy rule
    When I read the turn in the conversation thread
    Then the user side shows the redacted marker and no media

  @unimplemented
  Scenario: A recording is still there after switching to the side bubbles layout
    Given a turn whose media renders in the conversation thread
    When I switch the conversation to the side bubbles layout
    Then the recording is still offered on the side it belongs to

  # ===========================================================================
  # Trace summary strips: which side a recording belongs to
  # ===========================================================================
  # The trace's own input and output are flattened text, so the summary strips
  # render the compact media refs the fold derived. A
  # voice turn carries the caller's recording AND the agent's reply recording in
  # the same span payload, so a ref remembers the role of the chat message its
  # part was found under and each strip shows only the side it belongs to.
  # Traces ingested before roles were recorded carry none, and those keep
  # rendering on both strips rather than disappearing.
  #
  # The refs are gathered from EVERY span of the trace, not only from the span
  # that won the headline input and output. Those are two different questions:
  # which span names the trace, and where its media is. A wrapper span that sets
  # the headline text almost never holds the picture, so tying the refs to it
  # left the list and the strips empty for the most common trace shape there is.
  # The winning span's own media still comes first, so the thumbnail keeps
  # preferring the headline media when there is any.

  @unit
  Scenario: Media on a child span reaches the trace's refs
    Given a root span whose input is text only
    And a child model-call span whose input carries an externalized image
    When the fold derives the trace's media refs
    Then the trace's input refs carry the image

  @unit
  Scenario: The headline span's media is preferred over a child's
    Given both the winning span and a child span carry an externalized image
    When the fold derives the trace's media refs
    Then the winning span's image is the first input ref

  @unit
  Scenario: One recording reachable through two paths collapses to one ref
    Given a span payload that reaches the same externalized recording twice,
      once through the message content and once through a mirrored field
    When the fold derives the trace's media refs
    Then the recording is recorded once
    And the summary strip renders a single player for it
    # Content addressing means both paths resolve to the same stored object, so
    # a second ref can only ever draw the same bytes twice.

  @unit
  Scenario: The refs stay capped however many spans carry media
    Given a trace whose spans carry more distinct media than the per-side cap
    When the fold derives the trace's media refs
    Then no more than the capped number of refs is kept per side

  @unit
  Scenario: A media ref remembers the role of the message it came from
    Given a span input holding a user message with a recording and an assistant
      message with the reply recording
    When the fold derives the trace's media refs
    Then the first ref is marked as the user's and the second as the assistant's
    And a ref reached through a nested JSON string keeps the same role
    And an unrecognized role is recorded as no role at all

  @integration
  Scenario: The summary input strip carries only the audio spoken into the trace
    Given trace media refs where one recording is the user's and one is the assistant's
    When I open the trace summary
    Then the input strip shows a player for the user's recording only

  @integration
  Scenario: The summary output strip carries only the reply audio
    Given the same trace media refs
    When I open the trace summary
    Then the output strip shows a player for the assistant's recording only

  @integration
  Scenario: Media refs recorded without a role render on both summary strips
    Given a trace whose media refs carry no role, as traces ingested earlier do
    When I open the trace summary
    Then both the input and the output strip render the recording, as they did before

  # ===========================================================================
  # When the media cannot be played
  # ===========================================================================
  # A player that sits at zero seconds with no indication is worse than no
  # player: the viewer cannot tell a silent recording from a lost one. Every
  # exit from the loading state is visible, including the one where we cannot
  # even ask the server whether the bytes are still there.

  @integration
  Scenario: A recording whose bytes are gone shows an unavailable state, not a dead player
    Given a trace whose recording no longer has bytes in storage
    When I open the trace and the player fails to load
    Then the player is replaced by an unavailable state naming the media kind
    And no error internals are shown to the viewer

  @unit
  Scenario: Media the pipeline chose not to capture says so, and says how large it was
    Given a span whose content holds a summary of the media instead of the media,
      as an engine writes when an attachment is too large to carry
    When the trace renders that part
    Then the viewer is told the media was not captured, with its size
    And it is not reported as no longer available, which would send the reader
      looking for bytes that were never stored

  @integration
  Scenario: A media probe the viewer cannot run still leaves the unavailable state
    Given a viewer whose probe of the stored object fails
    When the player fails to load
    Then a placeholder is shown while the probe is in flight
    And the player resolves to an unavailable state instead of loading forever

  @integration
  Scenario: A viewer with trace access can probe trace media
    Given a viewer who holds traces:view on the project and nothing else
    When the trace drawer probes a stored object
    Then the probe answers, matching what the file route already allows
    And a viewer holding neither trace nor scenario access is refused

  # ===========================================================================
  # URL trust
  # ===========================================================================
  # Span content is attacker-controllable by anyone who can send traces to a
  # project, so every URL that reaches an element src or anchor href from
  # collected media must pass a scheme allowlist. Auto-mounted media (players,
  # thumbnails, chips) is stricter still: only content our own pipeline
  # produced (/api/files references and inline data payloads) — an external
  # http(s) src would beacon every viewer to an attacker-chosen host on open.

  @unit
  Scenario: A scripted URL in span content never reaches an anchor or element
    Given a span content part whose url is a javascript:, vbscript:, blob:,
      or protocol-relative // URL, in plain or control-character-split form
    When media is collected for rendering or parsed from summary refs
    Then the part is not collected and the ref is rejected
    And a part rendered directly with such a url shows a placeholder, not a link

  @unit
  Scenario: External http(s) media is not auto-mounted from collected content
    Given span content declaring media parts whose urls point at external hosts
      (image_url, binary-with-image-mime, audio, video)
    When media is collected for the strips, list previews, or summary refs
    Then none of them are collected or folded into refs
    And external links remain visible as links in the raw text view

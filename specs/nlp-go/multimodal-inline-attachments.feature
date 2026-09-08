Feature: Inline attachments reach the LLM as the content part their type calls for
  As a user who attaches a document, a recording or a table to a prompt
  I want an inline attachment to reach the model as content it can open
  So that the model reads the document instead of a wall of base64 text

  Background:
    A dataset cell of type image or file, and a prompt variable of type image or
    file, both carry their bytes as an inline data URL. The prompt template
    interpolates that URL into the message text, so without splitting, the model
    receives the base64 bytes as literal text.

    The engine already split data:image URLs into image parts. Every other media
    type stayed text, so a PDF a user attached was unreadable. Now every inline
    data URL becomes the part its media type calls for: a picture an image part,
    a recording an audio part, a document or another binary a file part, and
    text-like content is decoded back into readable text in the message.

    # Bindings: services/nlpgo/app/engine/multimodal_test.go
    # Split: services/nlpgo/app/engine/multimodal.go, part shapes in
    # services/nlpgo/app/engine/attachment.go

  @unit
  Scenario: An inline PDF data URL becomes a document part the model can read
    Given a user message whose text carries an inline PDF between two sentences
    When the engine builds the LLM messages
    Then the message content becomes a parts list of text, document, text
    And the document part is named document.pdf

  @unit
  Scenario: An inline audio data URL becomes an audio part the model can hear
    Given a user message whose text carries an inline MP3 recording
    When the engine builds the LLM messages
    Then the message carries an audio part in the format the provider expects

  @unit
  Scenario: An inline text data URL becomes readable text in the message
    Given a user message whose text carries an inline CSV table
    When the engine builds the LLM messages
    Then the message stays plain text with the table readable in place of the base64

  @unit
  Scenario: An inline data URL of an unrecognized type becomes a named file part
    Given a user message whose text carries an inline attachment of a type the engine has no shape for
    When the engine builds the LLM messages
    Then the message carries a file part named after the attachment type

  @unit
  Scenario: An inline document in the system prompt moves to a user message
    Given the prompt template places a document inside the instructions
    When the engine builds the LLM messages
    Then the system message keeps only the text before the document
    And a user message right after carries the document
    # Providers reject non-text parts in system-role messages, so a document
    # that lands in the instructions must be re-homed or the request fails.

  @unit
  Scenario: An inline data URL whose payload is not valid base64 is left as text
    Given a user message carrying something that looks like a data URL but does not decode
    When the engine builds the LLM messages
    Then the message stays plain text and nothing is dropped

Feature: Images attached to a Langy message reach the model

  A person can paste an image into the Langy composer, drop one on it, or pick one with the
  attach button. The image uploads to a signed URL as a stored object with the purpose
  langy_attachment (ADR-158), shows as a thumbnail above the text and as an inline chip at the
  place it was put in the text, and rides the sent message as a file part. When the turn is
  dispatched, Langy reads the image back from storage and hands its bytes to the model as image
  input, not only its name.

  @unit
  Scenario: A pasted image becomes an inline chip at the caret
    Given the composer holds "look at  please" with the caret after "at "
    When the person pastes an image with no file name
    Then the text holds a chip named like "pasted-1a2b3c.png" where the caret was
    And the chip is spaced from the words around it

  @unit
  Scenario: Backspace after an image chip removes the whole chip
    Given the composer text holds an image chip
    When the person presses Backspace right after it
    Then the whole chip leaves the text in one step

  @unit
  Scenario: Removing an image's chip from the text removes the image
    Given the composer holds an image and its chip
    When the chip's text is deleted from the draft
    Then the image is no longer attached to the draft

  @integration
  Scenario: The composer shows a thumbnail with a remove button for each attached image
    Given the Langy composer is open
    When the person pastes an image
    Then a thumbnail of it shows above the text with a button that removes it
    And an inline chip with the image's name sits in the text

  @integration
  Scenario: The composer has no Context and Skills hint buttons
    Given the Langy composer is open
    Then the rail under the text shows the model picker and the attach button
    And no "Context" or "Skills" hint button is shown

  @unit
  Scenario: An image upload is created for the langy_attachment purpose
    Given a person in a project with Langy
    When they start an upload of a PNG image of 1 MiB
    Then Langy asks stored objects for an upload with the purpose langy_attachment
    And the answer carries the signed URL to PUT the bytes to

  @unit
  Scenario: A file that is not an image is refused before it uploads
    Given a person in a project with Langy
    When they start an upload of a PDF
    Then the upload is refused with langy_attachment_refused naming the media type
    And no stored object is created

  @unit
  Scenario: An image over the size limit is refused before it uploads
    Given a person in a project with Langy
    When they start an upload of a PNG image larger than 5 MiB
    Then the upload is refused with langy_attachment_refused naming the limit
    And no stored object is created

  @unit
  Scenario: A failed upload leaves a failed thumbnail that blocks sending
    Given the person pasted an image
    When storing the image fails
    Then the thumbnail shows that it failed
    And the message cannot be sent until the failed image is removed

  @integration
  Scenario: A failed upload can be tried again from its thumbnail
    Given the person pasted an image whose upload failed
    When they press Retry on its thumbnail
    Then the image uploads again and the message can be sent once it is stored
    And a file Langy refused shows no Retry, only its remove button

  @unit
  Scenario: A confirmed image becomes a file part of the sent message
    Given an image whose upload was confirmed
    When the person sends the message
    Then the user message carries the text and a file part with the image's address, name and media type

  @unit
  Scenario: The image's bytes reach the worker as image input when the turn is dispatched
    Given a turn whose user message holds a confirmed langy_attachment image
    When the turn is dispatched to the worker
    Then the dispatch carries the image's media type, name and base64 bytes

  @unit
  Scenario: An image from another project or purpose is never read for a turn
    Given a user message whose file part names a stored object of another project or purpose
    When the turn is dispatched to the worker
    Then the image is left out of the dispatch
    And the turn still carries its text

  @unit
  Scenario: A message with more images than allowed is refused
    Given a user message with five images
    When the turn starts
    Then the turn is refused with langy_attachment_refused naming the limit of four images

  @unit
  Scenario: A conversation title shows an image by its file name
    Given a first message "What does [▣ pasted-4d80e6.png] show?"
    When the conversation takes its title from it
    Then the title reads "What does pasted-4d80e6.png show?"

  @integration
  Scenario: A sent message shows its images from signed URLs
    Given a sent user message that carries a stored image
    When the conversation shows it
    Then the image is drawn from a short-lived signed URL for that stored file
    And the image's chip in the text shows its file name

  @unit
  Scenario: A file whose bytes are not the image it claims is refused when it is confirmed
    Given a person uploaded a file named and typed as a PNG whose bytes are text
    When the upload is confirmed
    Then the confirmation is refused with langy_attachment_refused naming not_an_image
    And a stored image whose bytes are not its type is left out of a turn's dispatch

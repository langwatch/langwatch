Feature: User avatar upload errors
  As someone setting a profile photo
  I want one clear reason whenever a photo is refused
  So that I know what to do next, no matter which half of the app caught it

  # A photo is checked twice: the browser crops and re-encodes it before
  # anything is sent (processAvatarImage), and the server re-checks the payload
  # it receives (parseAvatarDataUrl). Both halves raise the SAME codes, so the
  # customer reads one sentence per outcome rather than two different-sounding
  # ones depending on which side got there first. The copy for each code lives
  # once, in the client presentation registry (ADR-045).

  Background:
    Given I am setting my profile photo

  @unit
  Scenario: A photo over the ceiling is refused with the size reason
    Given I pick an image larger than the upload ceiling
    When the browser prepares it
    Then the upload is refused as too large
    And the reason carries the ceiling so the copy can name it

  @unit
  Scenario: A file that is not an image is refused as unusable
    Given I pick a file that is not an image
    When the browser prepares it
    Then the upload is refused as an unusable image

  @unit
  Scenario: The server refuses an oversized payload with the same reason as the browser
    Given a payload larger than the upload ceiling reaches the server
    When the server validates it
    Then the upload is refused as too large

  @unit
  Scenario: The browser and the server refuse an oversized photo for the same reason
    Given an image larger than the upload ceiling
    When the browser refuses it and the server refuses the equivalent payload
    Then both refusals give the same reason

  @unit
  Scenario: The server refuses an image type it does not accept
    Given a payload declaring an image type outside the accepted list
    When the server validates it
    Then the upload is refused as an unsupported image type
    And the reason carries the accepted types so the copy can name them

  @unit
  Scenario: The server refuses a payload it cannot read as an image
    Given a payload that is not a readable image
    When the server validates it
    Then the upload is refused as an unusable image
    And the refusal records why it was unreadable for the logs

  @unit
  Scenario: Bytes that contradict the declared image type are refused as unusable
    Given a payload whose bytes do not match the image type it declares
    When the server validates it
    Then the upload is refused as an unusable image

  @unit
  Scenario: Changing the photo too often is refused with a wait, not an unknown error
    Given I have changed my photo more times than the limit allows in the window
    When the server refuses the next change
    Then I am told to wait and try again
    And I am not shown the generic unknown-error state

  @unit
  Scenario: A browser that cannot prepare the photo is not booked as a platform incident
    Given my browser cannot prepare the photo
    When the upload is refused
    Then the refusal is attributed to something only I can act on

  @unit
  Scenario: A refused upload never reaches storage or the account record
    Given I pick a file the server will refuse
    When the upload is attempted
    Then nothing is written to storage
    And my account record is left unchanged

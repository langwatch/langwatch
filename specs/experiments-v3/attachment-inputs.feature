Feature: An image or a file cell reaches the target as an attachment

  A dataset cell of type image or file holds a reference, not the bytes. An
  uploaded file is a LangWatch reference `/api/files/...`, which only the
  platform can read: it is relative, it is behind the session, and a service
  that tries to open it is refused. A cell can also hold an address on the
  public internet, or a data URL a customer pasted.

  The run resolves those references before it sends the row. A LangWatch
  reference always becomes a base64 data URL. An address on the public
  internet becomes one too when the target is an agent, because an agent runs
  outside the platform and cannot fetch what it cannot see. A prompt keeps the
  address, because the model service fetches it itself and reports its own
  error copy.

  A text column is never fetched, whatever it holds. A column that holds a
  release note with a link in it is text, and a run must not turn a sentence
  into a download.

  Background:
    Given a project with a dataset
    And an image column "screenshot" and a file column "report"

  @unit
  Scenario: A stored image reaches the model as base64
    Given the "screenshot" cell holds a LangWatch reference to a PNG
    And a prompt target with an image input mapped to "screenshot"
    When the row runs
    Then the model receives a base64 image data URL
    And the data URL carries no file name, so image handling is unchanged

  @unit
  Scenario: A stored file reaches the model as base64 with its name
    Given the "report" cell holds a LangWatch reference to "quarter.pdf"
    And a prompt target with a file input mapped to "report"
    When the row runs
    Then the model receives a base64 file data URL
    And the data URL carries the name "quarter.pdf"

  @unit
  Scenario: An agent receives base64 for a stored reference
    Given the "report" cell holds a LangWatch reference to "quarter.pdf"
    And an HTTP agent target with an input mapped to "report"
    When the row runs
    Then the request body carries the base64 data URL, not the reference

  @unit
  Scenario: An agent receives base64 for an address on the public internet
    Given the "screenshot" cell holds a public image address
    And an HTTP agent target with an input mapped to "screenshot"
    When the row runs
    Then the address is read by the platform
    And the request body carries the base64 data URL

  @unit
  Scenario: A prompt keeps an address on the public internet
    Given the "screenshot" cell holds a public image address
    And a prompt target with an image input mapped to "screenshot"
    When the row runs
    Then the address is sent as it is
    And the platform does not read it

  @unit
  Scenario: A text column that holds an address is not read
    Given a text column "notes" that holds "see https://example.com/report.pdf"
    And an HTTP agent target with an input mapped to "notes"
    When the row runs
    Then the text is sent as it is
    And the platform does not read the address

  @unit
  Scenario: A fixed address in a file input is read as an attachment
    Given an agent target with a file input set to a fixed public address
    When the row runs
    Then the platform reads the address and sends the bytes
    # No dataset column stands behind a fixed value, so the field the target
    # declares says what the value is.

  @unit
  Scenario: An address in an image input that serves something else fails the cell
    Given an agent target with an image input holding a public address
    And the address answers with a web page, not a picture
    When the row runs
    Then the cell fails with the attachment unavailable error code

  @unit
  Scenario: An address that declares a size over the ceiling is refused before it is read
    Given an agent target with a file input holding a public address
    And the address declares a size over the attachment ceiling
    When the row runs
    Then the cell fails with the attachment too large error code
    And the body is never read

  @unit
  Scenario: An address that keeps sending past the ceiling is cut
    Given an agent target with a file input holding a public address
    And the address declares no size and sends more than the ceiling allows
    When the row runs
    Then the cell fails with the attachment too large error code

  @unit
  Scenario: A stored object of another purpose is not readable as an attachment
    Given a cell that names a stored object kept as trace media
    When the row runs
    Then the cell fails with the attachment unavailable error code
    # Each purpose asks for its own permission on the read route, so a run must
    # not carry bytes the person could not open themselves.

  @unit
  Scenario: A connected agent receives the attachment beside the text
    Given a connected agent column with "input" mapped to a text column
    And "attachment" mapped to "screenshot"
    When the row runs
    Then the user message carries a text part with the row's input
    And an image part with the base64 data URL

  @unit
  Scenario: A connected agent parameter mapped to a file column receives base64
    Given a connected agent that declares the parameter "document"
    And a connected agent column with "document" mapped to "report"
    When the row runs
    Then the call carries the parameter "document" with the base64 data URL

  @unit
  Scenario: A missing stored object fails the cell
    Given the "report" cell holds a LangWatch reference that no longer resolves
    And a prompt target with a file input mapped to "report"
    When the row runs
    Then the cell fails with the attachment unavailable error code
    And the copy names the file and asks the person to upload it again

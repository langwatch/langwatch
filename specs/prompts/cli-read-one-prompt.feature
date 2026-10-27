Feature: Reading one prompt from the CLI

  Every resource in the CLI answers `get <id>` with the thing itself. Prompts
  answered `list` and `versions` but not `get`, so the only way to read one
  prompt was to list them all and filter, or to read the rows around it.

  This is an agent-facing gap more than a person-facing one. An agent told to
  improve a prompt reads it first, reaches for the verb every other resource
  takes, and gets "unknown command 'get'" with a usage dump. It then works from
  whatever it can reconstruct out of `versions`.

  @unit
  Scenario: Reading a prompt by its handle
    Given a prompt on the server
    When the reader asks the CLI for it by handle
    Then the prompt itself is returned, not its versions

  @unit
  Scenario: Reading an older version of a prompt
    Given a prompt on the server
    When the reader names a version
    Then that version is fetched instead of the latest

  @unit
  Scenario: Reading the version a tag points at
    Given a prompt on the server
    When the reader names a tag
    Then the version that tag points at is fetched

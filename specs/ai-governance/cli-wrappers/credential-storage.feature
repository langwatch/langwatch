Feature: The CLI never asks for a credential it cannot keep, and keeps it private
  Every credential the CLI holds was issued by the server and lives in a
  local file: the device session and the keys it minted in
  ~/.langwatch/config.json, a tool's ingest key in that tool's own settings
  file or the shell rc. Two ways this went wrong:

  A refresh token rotates once. When the config could not be written, the
  CLI rotated anyway, kept the new pair in memory for one run and lost it,
  and the next run presented a token the server had already spent: the
  person was logged out. The same silent save failure turned one personal
  virtual key into a new one on every run, each left live on the server.

  And the files holding an ingest key were written with the default mode,
  readable by every account on the machine, and the per-project Claude pin
  could be picked up by git.

  So the CLI checks that it can save before it asks the server for any
  credential, says so when a save it could not check fails, and writes
  every file that holds a key readable by its owner only.

  Background:
    Given the user has completed `langwatch login` (device-flow)

  Rule: nothing is issued when the config cannot be saved

    @unit
    Scenario: A refresh is refused when the config cannot be saved
      Given the access token has expired
      And ~/.langwatch/config.json cannot be written
      When any command needs a fresh access token
      Then the command fails saying the config cannot be saved and why
      And the refresh token is not sent to the server, so it stays valid

    @unit
    Scenario: A personal virtual key is not minted when the config cannot be saved
      Given the user has no personal virtual key on this machine
      And ~/.langwatch/config.json cannot be written
      When the user runs `langwatch claude` in gateway mode
      Then the command fails saying the config cannot be saved
      And no virtual key is issued on the server

    @unit
    Scenario: An ingest key is not minted when the config cannot be saved
      Given no ingest key for claude is cached
      And ~/.langwatch/config.json cannot be written
      When the user runs `langwatch claude` in ingestion mode
      Then the command fails saying the config cannot be saved
      And no ingest key is issued on the server

    @unit
    Scenario: A device login does not start when the config cannot be saved
      Given ~/.langwatch/config.json cannot be written
      When the user runs `langwatch login --device`
      Then the command fails saying the config cannot be saved
      And no device code is requested from the server

    @unit
    Scenario: A project login does not fork the session when the config cannot be saved
      Given ~/.langwatch/config.json cannot be written
      When the user runs `langwatch login --project <slug>`
      Then the command fails saying the config cannot be saved
      And the device session is not sent to the server

    @unit
    Scenario: A login that cannot refresh a tool's key says so
      Given claude's telemetry wiring points at a previous instance
      And ~/.langwatch/config.json cannot be written
      When the user logs in to the new instance
      Then the login warns that claude's telemetry was not refreshed and why

    @unit
    Scenario: The check writes and removes a probe beside the config
      Given the folder holding ~/.langwatch/config.json is missing
      When the CLI checks that it can save the config
      Then the folder is created owner-only
      And no probe file is left behind

  Rule: a save that fails after the server issued something is said out loud

    @unit
    Scenario: A rotated session that could not be saved is reported
      Given a refresh succeeded on the server
      And saving the new pair failed
      When the command carries on with the new access token
      Then a warning on stderr says the session could not be saved
        and the next run may ask the user to log in again

    @unit
    Scenario: A virtual key that could not be saved is reported
      Given the server issued a personal virtual key
      And saving it failed
      Then a warning on stderr names the virtual key and the config path

  Rule: every file that holds a key is readable by its owner only

    @unit
    Scenario: The shell rc carrying a tool's ingest key is made owner-only
      Given ~/.zshrc exists and is readable by everyone
      When langwatch writes a scoped `gemini` function into it
      Then ~/.zshrc is mode 0600

    @unit
    Scenario: A tool's settings file carrying the ingest key is owner-only
      When langwatch writes the telemetry env into ~/.claude/settings.json
      Then that file is mode 0600

    @unit
    Scenario: A file system that refuses chmod still gets the write
      Given the file system refuses to change a file's mode
      When langwatch writes a file that holds a key
      Then the content is written
      And a warning says the file could not be made private

    @unit
    Scenario: A new .env carrying the project key is owner-only
      Given the project has no .env
      When `langwatch login` writes LANGWATCH_API_KEY to it
      Then the new .env is mode 0600

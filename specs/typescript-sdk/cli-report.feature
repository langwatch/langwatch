@cli @support
Feature: CLI Agent Issue Reports
  As a coding agent (or the developer driving one) integrating LangWatch
  I want to send an issue report to the LangWatch team when I struggle or hit something broken
  So that LangWatch can fix confusing docs, rough CLI edges, and product bugs without the user having to copy-paste sessions manually

  Background:
    Given the `langwatch` CLI is available (npm install -g langwatch, or npx langwatch)

  # --- discovery ---

  @unit
  Scenario: Root help ends with a call to action for agents to report issues
    When I run "langwatch --help"
    Then the final section of the help output addresses AI agents directly
    And it says that if the agent struggled with anything or something is not working, it should run "langwatch report"
    And the note asks the agent to first get the user's permission

  @unit
  Scenario: Report help explains the two report modes
    When I run "langwatch report --help"
    Then the help explains a summary report: the agent writes what it was doing, what went wrong, and verbatim errors
    And the help explains a full session report: attaching the session transcript file as the most complete option
    And the help says the agent must ask the user for permission before sending either

  @unit
  Scenario: Report help tells agents where to find their own session transcript
    When I run "langwatch report --help"
    Then the help mentions that Claude Code sessions live under ~/.claude/projects as .jsonl files
    And the help mentions that Codex sessions live under ~/.codex/sessions as .jsonl files

  @unit
  Scenario: Report help explains redaction so agents can trust sending a full session
    When I run "langwatch report --help"
    Then the help says API keys, secrets, and personal data are redacted locally before anything is sent
    And it summarizes what gets redacted: API keys and tokens, passwords in URLs, private keys, emails, phone numbers, credit cards
    And it links to the redaction source file on GitHub so the agent can audit the exact patterns

  # --- consent ---

  @unit
  Scenario: Sending without user approval is rejected with instructions
    When I run "langwatch report --summary 'the docs told me to use an endpoint that 404s'"
    Then the command exits with a non-zero code
    And the error tells the agent to ask the user for permission and re-run with --user-approved

  # --- summary reports ---

  @integration
  Scenario: A summary report reaches the LangWatch backend
    Given the user approved sending a report
    When I run "langwatch report --user-approved --summary 'scenario create failed with a 500' --title 'scenario create 500'"
    Then the report is delivered to the LangWatch reports endpoint
    And the delivered report contains the summary text and the title
    And the CLI prints a confirmation with the report id and a thank-you note

  @integration
  Scenario: Reports work without an API key
    Given LANGWATCH_API_KEY is not set
    When I send a summary report with --user-approved
    Then the report is delivered successfully
    And no login or API key setup is required

  @integration
  Scenario: Reports are linked to the project when an API key is present
    Given LANGWATCH_API_KEY is set to a valid project key
    When I send a summary report with --user-approved
    Then the delivered report is associated with that project

  @unit
  Scenario: Summary can be read from a file for long content
    When I run "langwatch report --user-approved --summary-file ./notes.md --title 'confusing evaluator setup'"
    Then the content of notes.md becomes the report summary

  # --- full session reports ---

  @integration
  Scenario: A full session report attaches the redacted transcript
    Given a Claude Code session transcript file with an OpenAI API key inside a message
    When I run "langwatch report --user-approved --session ./transcript.jsonl --title 'agent got stuck instrumenting'"
    Then the delivered report includes the session transcript
    And the API key does not appear anywhere in the delivered payload
    And a redaction marker appears in its place

  @unit
  Scenario: Session redaction covers secrets, emails, phone numbers, and cards
    Given a session transcript containing an sk- API key, a bearer token, a database URL with a password, an email address, a phone number, and a credit card number
    When the transcript is prepared for sending
    Then each of those values is replaced with a redaction marker
    And the surrounding text is preserved so the session stays readable

  @unit
  Scenario: Secrets leaking into the title are redacted too
    When I run "langwatch report --user-approved --title 'auth with sk-... failed' --summary '...'"
    Then the delivered title carries a redaction marker instead of the key

  @unit
  Scenario: Environment secrets are scrubbed even in unusual formats
    Given the environment has LANGWATCH_API_KEY set
    And the session transcript contains that exact key value split into an unusual context
    When the transcript is prepared for sending
    Then the literal key value does not appear in the prepared payload

  @unit
  Scenario: Loopback and private network addresses stay readable
    Given a session transcript mentioning http://localhost:5560 and 127.0.0.1
    When the transcript is prepared for sending
    Then those addresses are preserved, because they are needed to debug local setups

  @unit
  Scenario: Oversized sessions are truncated from the start, keeping the most recent activity
    Given a session transcript larger than the upload limit
    When the transcript is prepared for sending
    Then the oldest lines are dropped until it fits
    And the report notes that the transcript was truncated

  # --- dry run for trust ---

  @unit
  Scenario: Dry run shows exactly what would be sent without sending it
    When I run "langwatch report --user-approved --session ./transcript.jsonl --dry-run"
    Then the redacted payload is printed to stdout
    And nothing is delivered to the backend

  @unit
  Scenario: Dry run needs no user approval, because nothing is sent
    When I run "langwatch report --session ./transcript.jsonl --dry-run" without --user-approved
    Then the redacted payload is printed to stdout
    And nothing is delivered to the backend
    And the agent can show the user the exact payload before asking for permission

  # --- error handling ---

  @unit
  Scenario: A missing session file fails with a helpful error
    When I run "langwatch report --user-approved --session ./does-not-exist.jsonl"
    Then the command exits with a non-zero code
    And the error names the missing file

  @unit
  Scenario: Backend being unreachable fails politely without losing the summary
    Given the reports endpoint is unreachable
    When I send a summary report with --user-approved
    Then the command exits with a non-zero code
    And the error suggests retrying and mentions support@langwatch.ai as a fallback

Feature: S3PollingPullerAdapter (universal S3-polling adapter)
  As a customer whose AI platform drops audit logs as NDJSON / CSV / JSON
  files in an S3 bucket on a schedule (Anthropic compliance dump, OpenAI
  enterprise audit export, custom S3-to-archive pipelines)
  I want a generic S3-polling adapter that watches a bucket+prefix, reads
  new keys lexicographically, parses the configured format, and feeds events
  to the unified ingest path
  So that S3-drop-style integrations don't need bespoke adapter code

  Cursor = lexicographic-max key seen so far. Resume-from-cursor = list
  keys lexicographically AFTER the cursor.

  Background:
    Given an IngestionSource of type `pull` with adapter `s3_polling`

  Scenario: Config shape
    Given the pullConfig is:
      """
      {
        "adapter": "s3_polling",
        "bucket": "acme-audit-logs",
        "prefix": "anthropic/compliance/",
        "region": "us-east-1",
        "credentialRef": "acme_aws_creds",
        "parser": "ndjson",
        "schedule": "0 * * * *",
        "eventMapping": { … same JSON-path shape as http_polling … }
      }
      """
    When `validateConfig(pullConfig)` runs
    Then no error is thrown

  Scenario: Happy-path drain
    Given S3 has keys `[anthropic/compliance/2026-05-03-00.ndjson, anthropic/compliance/2026-05-03-01.ndjson]`
    And `IngestionSource.lastCursor` is `null` (first pull)
    When the worker calls `runOnce({ cursor: null })`
    Then the adapter LIST'S the bucket+prefix in lexicographic order
    And reads + parses both files via the ndjson parser
    And returns `{ events: [...all events from both files...], cursor: "anthropic/compliance/2026-05-03-01.ndjson", errorCount: 0 }`

  Scenario: Cursor resume skips already-seen keys
    Given `IngestionSource.lastCursor` is `anthropic/compliance/2026-05-03-01.ndjson`
    And S3 has keys `[anthropic/compliance/2026-05-03-00.ndjson, …01.ndjson, …02.ndjson, …03.ndjson]`
    When the worker calls `runOnce({ cursor: "anthropic/compliance/2026-05-03-01.ndjson" })`
    Then the adapter only reads the 2 keys lexicographically AFTER the cursor (`…02` + `…03`)
    And returns the new cursor `anthropic/compliance/2026-05-03-03.ndjson`

  Scenario: Empty pull when no new keys
    Given `IngestionSource.lastCursor` is at the latest key
    When the worker calls `runOnce({ cursor: <latest> })`
    Then the adapter returns `{ events: [], cursor: <latest>, errorCount: 0 }`
    And the process wake schedules next per the cron schedule

  Scenario: Parser switches per config
    | parser     | example body                          | event count |
    | ndjson     | {"a":1}\n{"a":2}\n{"a":3}             | 3           |
    | json-array | [{"a":1},{"a":2},{"a":3}]             | 3           |
    | csv        | headers + 3 data rows                 | 3           |
    Given pullConfig.parser is each of the values above
    When the adapter reads a file and parses it
    Then it emits the expected event count regardless of format

  @unit
  Scenario: Malformed file skipped, run continues
    Given key `anthropic/compliance/2026-05-03-bad.ndjson` contains an unparseable line
    When the adapter encounters the bad line
    Then the bad line is logged + captureException'd
    And the adapter continues parsing subsequent valid lines
    And `errorCount` reflects the number of bad lines seen
    And the cursor STILL advances past the file (we don't re-pull broken files indefinitely)

  Scenario: Credential rotation honored
    Given the credentialRef resolves to NEW credentials on a subsequent run
    When the adapter requests a fresh AWS S3 client
    Then it fetches the latest credentials (no in-process credential caching across runOnce calls)

  Rule: The OpenAI compliance export names people by id and keeps nothing it does not need

    OpenAI's compliance export carries both the person's id and their email
    on every line. The audit trail names the person by the id the provider
    owns; the address is left where it came from. And because that address
    would otherwise ride along inside a verbatim copy of the line, the
    OpenAI compliance source keeps no such copy: the audit row holds the
    fields it was mapped to and nothing else.

    Background:
      Given an IngestionSource of type `openai_compliance`
      And the bucket holds a compliance line whose `user` has both an `id` and an `email`

    @unit
    Scenario: An OpenAI compliance event names the person by their provider id, never by email
      When the puller reads the line
      Then the event's actor is the person's provider id
      And the email appears nowhere in the emitted record

    @unit
    Scenario: An OpenAI compliance event keeps no raw copy of what the provider sent
      When the puller reads the line and the worker maps it to an audit row
      Then the audit row carries no verbatim copy of the provider's line
      And the email appears nowhere in the audit row

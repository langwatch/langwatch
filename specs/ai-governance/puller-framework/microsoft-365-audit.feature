Feature: microsoft_365_audit ingestion source (Office 365 Management Activity API)
  As a compliance owner whose organisation runs Copilot Studio agents
  I want an ingestion source that pulls real Copilot interaction records
  So that the governance surface reports coverage it actually has

  Replaces `copilot_studio`, which polled `auditLogs/directoryAudits` — an
  Entra directory-change feed that never contained a single Copilot
  interaction.

  Precisely: such a source does not report healthy. `IngestionSource.status`
  defaults to `awaiting_first_event` and only leaves that state once an event
  arrives, so these sources have sat in `awaiting_first_event` indefinitely.
  The defect is that this state is indistinguishable from a source created
  five minutes ago — there is no escalation for one that has been waiting for
  months, and the surrounding copy and docs told operators it was working.

  Endpoint (verified against Microsoft docs at filing):
    POST /api/v1.0/{tenantId}/activity/feed/subscriptions/start?contentType=Audit.General
    GET  /api/v1.0/{tenantId}/activity/feed/subscriptions/content
           ?contentType=Audit.General&startTime={t0}&endTime={t1}
    GET  {contentUri}                       # one blob per listing entry
  Auth: OAuth2 client-credentials, scope `https://manage.office.com/.default`,
  permission `ActivityFeed.Read`. `RecordType: 261` filtered client-side.

  NOT the Graph audit-query API. That API was demoted from v1.0 back to beta,
  and the same completed query paginated twice inside ten minutes returned
  ~340k vs ~400k records. Duplicates collapse in the ReplacingMergeTree; skips
  do not. It is the migration target, not a rejected option.

  Cursor carries the whole state machine:

    { version, phase, windowStart, windowEnd, blobQueue[], nextPageUri?, watermark }

  Storage is `IngestionSource.pollerCursor Json?`, but the adapter never sees
  the column: `ingestionPullLifecycle.ts:27-34` flattens it to `string | null`
  via JSON.stringify before it reaches `PullRunOptions.cursor`. So the adapter
  parses a JSON string and carries its own `version` key. Prefer a `version`
  field inside the object over a `v1:` string prefix — the prefix would make
  the stored column an opaque string and give up its queryability for nothing.

  Separately, there is no `pullConfig` column at all; config lives in the one
  `parserConfig` JSONB (ingestionSource.service.ts:343-346).

  phase ∈ { listing, draining }. The restart guarantee in pullerAdapter.ts:93-95
  is the hard requirement: a worker crash plus restart on the same cursor must
  not skip events.

  Scenarios tagged @doc-derived rest on Microsoft's documentation and cannot be
  empirically verified without a live tenant. They assert our reading of the
  contract, not the vendor's behaviour. A documented-but-wrong API is exactly
  what the Graph pagination defect was.

  "Duplicates are safe, skips are not" is the argument the whole restart design
  rests on, and it holds only while the dedup key is derived purely from record
  content. If the key ever includes a run id, an ingestion timestamp, or a
  generated uuid, re-drained blobs double-count instead of collapsing and the
  design becomes actively harmful. That property is asserted below rather than
  assumed.

  This feature has no @e2e tier, deliberately. The external dependency is a
  Microsoft tenant that CI cannot reach, so the highest level achievable is
  @integration against a fixture server. Read the missing tier as a stated
  limit, not an oversight: these tests prove our state machine is restart-safe
  and prove nothing about whether the vendor API behaves as documented.

  Background:
    Given an IngestionSource of type `pull` with adapter `microsoft_365_audit`

  # ---------------------------------------------------------------------------
  # Config
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Config shape validates
    Given the pullConfig is:
      """
      {
        "adapter": "microsoft_365_audit",
        "tenantId": "acme-tenant-guid",
        "contentType": "Audit.General",
        "schedule": "*/15 * * * *",
        "credentials": {
          "tenantId": "acme-tenant-guid",
          "clientId": "acme-app-guid",
          "clientSecret": "enc:v1:…"
        }
      }
      """
    When `validateConfig(pullConfig)` runs
    Then no error is thrown

  @unit
  Scenario: Config missing any credential field is rejected with a registered error code
    Given the pullConfig omits one of `tenantId`, `clientId`, or `clientSecret`
    When `validateConfig(pullConfig)` runs
    Then it throws an error whose code is registered in the presentation layer
    And the message names the missing field
    And the message does not contain any credential value

  # ---------------------------------------------------------------------------
  # Prerequisite 1 — OAuth2 client-credentials
  # `pullers/shared/oauthClientCredentials.ts`
  #
  # DECIDED: per-run local token, NOT a module-level cross-run cache. Runs fire
  # every 15 minutes against a token TTL of roughly an hour, so holding the
  # token in a local for the duration of one run captures nearly all the
  # benefit at the cost of about four extra token requests an hour, which is
  # trivially within limits. This deletes single-flight coordination and the
  # module-level cache, and with them the risk of that cache quietly becoming
  # the per-source instance state pullerAdapter.ts:141-146 forbids.
  #
  # If a future change makes token requests expensive enough to matter, the
  # cross-run cache is the thing to add back — and it must be keyed on
  # tenant + client + scope together, or one tenant will receive another's
  # token.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Token is fetched once per run and reused for that run's requests
    Given a run that issues several API requests
    When the adapter obtains a token
    Then the token endpoint is called exactly once for the run
    And every request in that run carries the same token

  @unit
  Scenario: A token expiring mid-run is refreshed before it is used
    Given a token whose lifetime ends before the run does
    When a request is made after the refresh margin is crossed
    Then a fresh token is obtained first
    And no request is ever made with an expired token

  @unit
  Scenario: Token value never reaches logs or error messages
    Given the token endpoint returns a token
    And the subsequent content request fails
    When the failure is logged and the error surfaced
    Then neither the log output nor the error message contains the token
    And neither contains the client secret

  # ---------------------------------------------------------------------------
  # Prerequisite 4 — 429 / Retry-After
  # Lifted from httpPollingPullerAdapter.ts:163-230 into
  # `pullers/shared/httpRetry.ts`. Extraction also fixes `http_custom` and
  # `claude_compliance`, which today retry 5xx but not 429.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Retry behaviour per response status
    | status | Retry-After | behaviour                                  |
    | 200    | —           | returns body, no retry                     |
    | 429    | 2           | waits 2s, retries, succeeds                |
    | 429    | absent      | waits per backoff schedule, retries        |
    | 503    | —           | retries per existing 5xx path              |
    | 400    | —           | fails fast, no retry                       |
    | 401    | —           | fails fast, no retry                       |
    Given the server responds with each status above
    When the shared retry helper issues the request
    Then it behaves as described
    And 4xx other than 429 is never retried

  @unit
  Scenario: Retry budget exhausted surfaces the failure rather than returning empty
    Given the server returns 429 on every attempt
    When the retry budget is exhausted
    Then the helper throws
    And the run reports an error
    And the run does not report a successful empty pull

  @integration
  Scenario: Existing adapters gain 429 handling without losing their failure signal
    Given `http_custom` and `claude_compliance`, which today fail fast on 429
    When they adopt the shared retry helper
    Then a 429 that resolves inside the budget is retried and succeeds
    And a 429 that does not resolve still ends the run with a visible error
    And neither adapter converts a previously visible error into a silent timeout

  @unit
  Scenario: Retry wait that would overrun the job deadline is not attempted
    Given a Retry-After longer than the remaining time before PER_JOB_DEADLINE_MS
    When the helper considers the retry
    Then it does not sleep past the deadline
    And it returns control so the cursor can be persisted for the next run

  # ---------------------------------------------------------------------------
  # Prerequisite 2 — credential seam (#6785)
  # Today the UI submits a bare `{ adapter }` (ingestion-sources.tsx:317-324),
  # so clientSecret is stored nowhere at all.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Client secret submitted in the UI reaches the adapter decrypted
    Given an operator submits tenantId, clientId, and clientSecret
    When the source is saved
    Then the secret is persisted under `credentials` with the `enc:v1:` prefix
    And the plaintext secret appears nowhere in the stored row
    And the puller worker decrypts it back to the original value at run time

  @unit
  Scenario: parserConfig cannot override pullConfig-owned fields
    Given `parserConfig` and `pullConfig` both carry a key owned by pullConfig
    When the merge runs
    Then the pullConfig-owned value wins
    And the parserConfig value is stripped rather than silently applied
    And the merge is a pure function, extracted out of the Prisma create call
      at ingestionSource.service.ts:355-356 so precedence is testable without a
      database

  # ---------------------------------------------------------------------------
  # Cursor codec
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Cursor round-trips through encode and decode
    Given a cursor state with phase `draining`, a three-entry blobQueue, and a watermark
    When it is encoded and decoded
    Then the decoded state equals the original

  @unit
  Scenario: Undecodable cursor resumes from the watermark instead of throwing
    | cursor                          | reason            |
    | not-json                        | corrupt           |
    | {"version":0}                   | unknown version   |
    | {"version":1,"phase":"nonsense"}| unknown phase     |
    | "a legacy bare string cursor"   | pre-existing shape|
    Given each cursor above is passed to `runOnce`
    When the adapter decodes it
    Then it does not throw
    And it resumes from the last recoverable watermark
    And it never restarts the window from zero

  # ---------------------------------------------------------------------------
  # Subscription lifecycle + drain
  # ---------------------------------------------------------------------------

  @integration @doc-derived
  Scenario: Subscription is started once and not restarted while active
    Given the tenant has no active Audit.General subscription
    When the adapter runs
    Then it calls subscriptions/start exactly once
    And on the following run, with the subscription already active, it does not call start again

  @integration @doc-derived
  Scenario: A subscription that lapsed is restarted rather than assumed active
    Given the adapter previously observed an active subscription
    And the subscription has since been stopped outside this system
    When the adapter runs and the content listing reports no active subscription
    Then it restarts the subscription
    And it surfaces that a gap occurred, because the API does not backfill

  @integration @doc-derived
  Scenario: First run after enabling reports that history is not available
    Given a source enabled for a tenant with no prior subscription
    When the first run completes
    Then the run does not report an empty window as healthy steady state
    And the operator is told content accrues only from subscription time forward

  @integration
  Scenario: Prolonged zero-event ingestion is surfaced, not read as a quiet tenant
    Given the source authenticates, subscribes, and lists successfully
    And `status` is still `awaiting_first_event` with `lastEventAt` null
    And no RecordType 261 record appears for a sustained number of consecutive runs
    When that threshold is crossed
    Then the source is distinguishable from one created minutes ago
    And it is distinguishable from an error, which `errorCount` already covers
    And the operator is told the source is configured but has produced nothing

  @integration @doc-derived
  Scenario: Happy-path drain over one window
    Given the content listing for the window returns three blob URIs
    And each blob contains Copilot interaction records
    When the worker calls `runOnce({ cursor: null })`
    Then all three blobs are fetched
    And every record in them is emitted as a normalized event
    And the returned cursor carries a watermark at the window end

  @integration
  Scenario: Run cut off mid-queue resumes without skipping or duplicating
    Given the listing for the window returns five blob URIs
    And the job deadline expires after the second blob is drained
    When run 1 returns its cursor
    And run 2 is started with that cursor
    Then the union of events from both runs equals every record in the window
    And no blob is fetched in both runs
    And no blob is left unfetched

  @unit
  Scenario: Dedup key is derived only from record content
    Given the same Copilot interaction record is mapped in two separate runs
    When the two resulting OCSF rows are compared
    Then their dedup keys are identical
    And the key is derived from no run id, ingestion timestamp, or generated uuid
    And the two rows collapse rather than double-count

  @integration
  Scenario: Hard crash before the cursor persists re-drains rather than skips
    Given run 1 drains two of five blobs and is killed before returning a cursor
    And the persisted cursor is therefore still the one run 1 started from
    When run 2 starts from that persisted cursor
    Then every record in the window is emitted
    And the records from the first two blobs arrive twice
    And those duplicates collapse on their content-derived dedup key

  @integration
  Scenario: Blob queue carried in the cursor is bounded
    Given a window whose listing yields more blobs than the queue cap
    When the cursor is written
    Then the queue holds at most the cap
    And the remainder is recoverable via the recorded listing position
    And the cursor does not grow unboundedly with tenant volume

  @integration
  Scenario: Page cap is a resume point, not silent truncation
    Given the content listing pages past MAX_PAGES_PER_RUN
    When the cap is reached
    Then the cursor records the next page URI
    And the following run continues from that page
    And the run does not report the window as complete

  @integration
  Scenario: Deadline is checked between blobs, not only between pages
    Given a queue of blobs where one blob's fetch consumes most of the remaining budget
    When the deadline passes mid-queue
    Then the adapter stops before starting the next blob
    And returns a cursor whose blobQueue holds exactly the undrained blobs

  # ---------------------------------------------------------------------------
  # Event mapping
  # Four identity traps, all documented in issue #7137.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Only Copilot interaction records are emitted
    Given a blob containing records with RecordType 261 and other record types
    When the adapter maps the blob
    Then only the RecordType 261 records are emitted
    And the filtered-out records are counted, not silently dropped

  @unit
  Scenario: The three user identifiers are mapped to distinct fields
    Given a record carrying `UserId` (a UPN) and `UserKey` (a PUID)
    When the record is mapped
    Then the UPN and the PUID land in separate fields
    And neither is written to an Entra-object-id field
    And no field claims to hold an Entra object id, because the record carries none

  @unit
  Scenario: Non-human actors are not attributed to a person
    | UserType | actor          |
    | 5        | application    |
    | 6        | service principal |
    Given a record with each UserType above
    When the record is mapped
    Then the event is marked as a non-human actor
    And it is not attributed to a human user

  @unit
  Scenario: Cost and token fields are zero because the source cannot carry them
    Given any Copilot interaction record
    When the record is mapped
    Then `cost_usd`, `tokens_input`, and `tokens_output` are 0
    And the mapping carries a comment stating why: Copilot is seat-licensed,
        `Messages[].Size` is documented as unused, and Copilot Studio credits
        are exposed only as a Power Platform admin-centre CSV

  @unit
  Scenario: Raw payload is preserved verbatim for downstream replay
    Given a Copilot interaction record
    When the record is mapped
    Then `raw_payload` holds the unmodified record
    And it reaches `metadata.extension.raw_event` in the OCSF row

  @unit @doc-derived
  Scenario: AgentId is carried through without asserting an inventory join
    Given a record with `AgentId` of the form `CopilotStudio.Declarative.<guid>`
    When the record is mapped
    Then the AgentId is carried on the event verbatim
    And no join to an inventory botId is performed
    And the absence of an environment id on the record is not papered over

  # ---------------------------------------------------------------------------
  # Retirement of copilot_studio
  # These scenarios are the stop-the-bleeding half of this work and depend on
  # none of the above.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Existing copilot_studio sources are disabled with a stated reason
    Given a workspace with an enabled `copilot_studio` source
    When the migration runs
    Then the source status becomes `disabled`
    And a reason is stamped explaining the endpoint never returned interactions
    And the source's existing config is left untouched rather than repointed

  @integration
  Scenario: Migration is idempotent and does not clobber a deliberate re-enable
    Given the migration has already disabled a `copilot_studio` source
    And an admin has since deliberately re-enabled it
    When the migration runs a second time
    Then the re-enabled source is left as the admin set it
    And no source is disabled twice or stamped with a duplicate reason

  @integration
  Scenario: copilot_studio can no longer be selected in the picker
    When an operator opens the ingestion-source picker
    Then `copilot_studio` is not offered
    And `microsoft_365_audit` is offered in its place

  @unit
  Scenario: The registry no longer resolves the copilot_studio adapter id
    When the puller registry is asked for the `copilot_studio` adapter
    Then it does not resolve an adapter
    And it resolves `microsoft_365_audit` instead

  @unit
  Scenario: Published documentation stops advertising the retired source
    Given `docs/ai-governance/ingestion-sources/copilot-studio.mdx` is listed in
      the docs nav at docs.json:733 and has a redirect at docs.json:1741
    When the source is retired
    Then the MDX describes `microsoft_365_audit` and the API it actually calls
    And the nav entry and the redirect target both still point at a page that exists
    And the MDX no longer states that events do not flow yet

  @unit
  Scenario: The two known-false copy strings are gone
    Given the ingestion-source picker previously claimed to poll a Purview
      audit API that was never built, and claimed a credential is hashed
      server-side when nothing hashes or persists it
    When the source tree is checked for those two strings
    Then neither string is present
    And the replacement copy names the API the adapter actually calls

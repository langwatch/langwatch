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
  five minutes ago: there is no escalation for one that has been waiting for
  months.

  The published docs were not the problem — they said plainly that no poller
  had shipped and that events did not flow. They were stale in the opposite
  direction, still describing an unshipped poller after a broken one landed,
  and they named the correct API throughout. What lied was the admin UI copy
  at ingestion-sources.tsx:112, which claimed the source polls an API that no
  code ever called.

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
  `parserConfig` JSONB
  (activity-monitor/ingestionSource.service.ts:342-357).

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
  Microsoft tenant that CI cannot reach. Read the missing tier as a stated
  limit, not an oversight: these tests prove our state machine is restart-safe
  and prove nothing about whether the vendor API behaves as documented.

  The drain scenarios are @unit rather than @integration, following
  httpPollingPullerAdapter.unit.test.ts: they drive the whole adapter against
  a fixture with `ssrfSafeFetch` mocked, and touch no datastore. This repo's
  @integration lane is specifically a datastore lane that boots real Redis and
  ClickHouse, which these need and use none of. The remaining @integration
  scenarios are the ones that genuinely cross into the database.

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

  # The codes below are why the numbers are carried at all: a wrong secret, an
  # app missing from the tenant, a tenant that does not exist and a scope whose
  # resource principal was never provisioned all answer with the same status,
  # and only the number distinguishes them. That mapping is Azure's, not ours —
  # it is recorded here as the motivation and is deliberately NOT asserted
  # below, because no test of ours can observe what a code means to Azure.
  # Unverified against the live endpoint: our probe obtained a token
  # successfully, so none of these four refusals has actually been seen.
  @unit
  Scenario: A token-endpoint refusal is raised as TokenAcquisitionError
    Given the token endpoint refuses the client credentials
    When the adapter tries to obtain a token
    Then the failure is raised as a token acquisition error carrying the status
    And it carries whatever numeric codes the endpoint sent, unchanged
    And a refusal that sent no codes yields an empty list rather than failing
    And the refusal text is not carried on the error
    And a failure that is not a refusal keeps the type it already had

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

  @unit
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

  @unit @doc-derived
  Scenario: Subscription is started once and not restarted while active
    Given the tenant has no active Audit.General subscription
    When the adapter runs
    Then it calls subscriptions/start exactly once
    And on the following run, with the subscription already active, it does not call start again

  @unit @doc-derived
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

  @unit @doc-derived
  Scenario: Happy-path drain over one window
    Given the content listing for the window returns three blob URIs
    And each blob contains Copilot interaction records
    When the worker calls `runOnce({ cursor: null })`
    Then all three blobs are fetched
    And every record in them is emitted as a normalized event
    And the returned cursor carries a watermark at the window end

  @unit
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

  @unit
  Scenario: Hard crash before the cursor persists re-drains rather than skips
    Given run 1 drains two of five blobs and is killed before returning a cursor
    And the persisted cursor is therefore still the one run 1 started from
    When run 2 starts from that persisted cursor
    Then every record in the window is emitted
    And the records from the first two blobs arrive twice
    And those duplicates collapse on their content-derived dedup key

  # Replaces "Blob queue carried in the cursor is bounded", which asserted the
  # queue was truncated to the cap on write. Nothing re-lists a dropped blob
  # URI, so that was silent loss of audit records, and the window went on to
  # look complete. The cap bounds how much more is listed, not what is kept.
  @unit @regression
  Scenario: A queue above the listing cap survives the round trip intact
    Given a queue holding more blob URIs than the listing cap
    When the cursor is written and read back
    Then every queued URI is still present, in listing order
    And no window is reported complete while URIs remain undrained

  @unit @regression
  Scenario: A queue above the corruption ceiling is rejected, not truncated
    Given a cursor whose queue is larger than anything this adapter can write
    When the cursor is read
    Then it is rejected rather than trimmed to fit
    And the run resumes from the watermark, re-listing the window

  @unit
  Scenario: An already-enabled subscription is not an error
    Given a subscription start that answers HTTP 400 with code AF20024
    When the run starts
    Then the run treats it as success and goes on to list the window

  @unit
  Scenario: A subscription failure that is not AF20024 fails the run
    Given a subscription start that answers HTTP 400 for another reason
    When the run starts
    Then the run fails rather than reporting a healthy, silent source
    And no content listing is attempted

  @unit
  Scenario: parserConfig cannot repoint a microsoft_365_audit source
    Given a pullConfig carrying the composer's tenant id and content type
    And a parserConfig carrying different values for both
    When the two are merged
    Then the composer's values win
    And the overridden keys are reported as stripped

  @unit
  Scenario: Page cap is a resume point, not silent truncation
    Given the content listing pages past MAX_PAGES_PER_RUN
    When the cap is reached
    Then the cursor records the next page URI
    And the following run continues from that page
    And the run does not report the window as complete

  @unit
  Scenario: Deadline is checked between blobs, not only between pages
    Given a queue of blobs where one blob's fetch consumes most of the remaining budget
    When the deadline passes mid-queue
    Then the adapter stops before starting the next blob
    And returns a cursor whose blobQueue holds exactly the undrained blobs

  # ---------------------------------------------------------------------------
  # Response-supplied URL boundary
  #
  # Found in review (PR #7142, review 4970629365), not in planning. contentUri
  # and the nextpageuri response header are both copied out of the API's own
  # response — and nextpageuri is persisted into the cursor — then used as the
  # next fetch target with the Management Activity OAuth bearer token
  # attached. Without a host/path check, a malformed response — or a cursor
  # poisoned before this check existed — turns the poller into a
  # token-forwarding primitive for whatever URL it names.
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: A response-supplied URL outside the trusted host is refused
    Given a contentUri, a nextpageuri response header, or a persisted cursor
      field naming a URL outside https://manage.office.com/api/v1.0
    When the adapter would otherwise fetch it with the bearer token attached
    Then it throws rather than sending the token to that URL
    And nothing is ever fetched from the untrusted URL

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

  @unit
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
  Scenario: Documentation stops describing a poller that has not shipped
    Given the docs page said no poller existed and events did not flow, which
      went stale when a broken poller landed
    When the source is retired
    Then the page describes `microsoft_365_audit` and the API it actually calls
    And it states that the feed does not backfill
    And it tells an operator with an existing `copilot_studio` source to re-create it
    And every nav entry and redirect resolves to a page that exists, so the
      previously published URL does not 404

  @unit
  Scenario: The two known-false copy strings are gone
    Given the ingestion-source picker previously claimed to poll a Purview
      audit API that was never built, and claimed a credential is hashed
      server-side when nothing hashes or persists it
    When the source tree is checked for those two strings
    Then neither string is present
    And the replacement copy names the API the adapter actually calls

  # Found in review, not in planning. The first cut advanced only the
  # watermark and left the window pinned, so every run after the first
  # re-listed the same hour and no new event was ever ingested — the source
  # would have reproduced, inside its replacement, the exact silence that
  # retired copilot_studio.
  @unit @regression
  Scenario: A completed window advances so the next run sees new activity
    Given a run that drained its window completely
    When the next scheduled run fires an hour later
    Then it lists a window it has not listed before
    And that window starts exactly where the previous one ended
    And the watermark records the boundary that is now fully ingested

  @unit @regression
  Scenario: Catching up after downtime advances in bounded steps
    Given a source whose last completed window ended a week ago
    When the next run fires
    Then the window it claims is no wider than the configured maximum
    And the window is not empty

  # An untouched cursor and a fully-drained one are the same shape: empty
  # queue, nothing deferred. Reading completion off that shape is guessing,
  # and a window guessed complete is never listed again by anyone.
  #
  # No caller reaches this today: the worker computes its deadline inline
  # immediately before the call, so a run is never out of time on entry, and
  # every mid-run timeout leaves either a queued blob or a deferred page
  # behind. This pins the invariant rather than a production event — the
  # adapter must know it finished, not infer it — so that a future caller
  # (a retry that reuses a deadline, a queue that hands back a stale one)
  # cannot quietly reintroduce the skip.
  @unit @regression
  Scenario: Completion is reported by the run, not inferred from cursor shape
    Given a run that is out of time before it lists anything
    When the run returns
    Then it emits no events
    And the window it was given is left in place for the next run

  @unit
  Scenario: An oversized error body is bounded before it is allocated
    Given an error response whose body is far larger than the diagnostic ceiling
    When the failure is read so it can be reported
    Then only up to the ceiling is read from the response
    And the remainder is never pulled from the connection

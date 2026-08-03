Feature: Per-end-user budgets by attribution
  As a platform rebilling my own customers
  I want each distinct end user on a tenant key capped by one template rule
  So that one runaway user is stopped without provisioning anything per user

  # Background
  #
  # An ATTRIBUTED_USER budget is a TEMPLATE anchored on a virtual key or a
  # project: "each distinct end user: this limit per window". The request
  # carries the end-user id (the OpenAI `user` field or a header); spend
  # accrues into lazy per-(anchor, end user) buckets keyed
  # "<anchorId>:<endUserId>", the same shape as the group cascade's
  # per-member buckets. The bundle carries the one template entry, never
  # per-user rows: the population is unbounded and belongs in the ledger,
  # not the config.

  Background:
    Given an organization with a virtual key serving multi-tenant traffic

  # ────────────────────────────────────────────────────────────────────────────
  # Capture
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: The end-user id resolves headers first, then the body user field
    Given a request with both an end-user header and a body user field
    When the gateway resolves the end-user id
    Then the header value wins
    And the LiteLLM migration alias header is accepted at lower precedence
    # One resolver feeds spend admission and budget enforcement, so
    # metering and capping can never disagree about who a request was.

  # ────────────────────────────────────────────────────────────────────────────
  # Template resolution
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: A template resolves to the request's own bucket when the end user is known
    Given an attributed-user template anchored on the key
    When budgets resolve for a request carrying an end-user id
    Then the template's bucket is the anchor and end-user id joined
    And a provider-filtered template suffixes its provider onto the bucket

  @unit
  Scenario: A template resolves as itself when no end user is in context
    Given an attributed-user template anchored on the key
    When budgets resolve without an end-user id
    Then the template resolves with the anchor as its bucket
    And it is marked as applying per user
    # The bundle materialises from this shape: one entry, per_user flag,
    # no aggregate spend figure (each bucket has its own).

  @unit
  Scenario: Templates anchor on virtual keys and projects only
    Given an attributed-user budget create request
    When the anchor is not exactly one virtual key or project in the caller's organization
    Then creation is refused with an actionable scope error

  # ────────────────────────────────────────────────────────────────────────────
  # Enforcement
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: A request with no end-user id is rejected while a template is active
    Given the bundle carries an attributed-user template
    When a request arrives without an end-user id anywhere we resolve one
    Then the request is rejected with the end-user-required error naming both wire fields
    # Fail closed: a cap evadable by omitting a field is not a cap. The
    # rejection still admits and fails through the spend spine, so it is
    # recorded and visible per key.

  @unit
  Scenario: The end-user bucket figure decides block and warn for templates
    Given a template at limit for one end user's bucket
    When that user's request is prechecked
    Then it blocks naming the attributed-user scope
    And another user's request on the same key passes
    # The bundle's own spent figure is meaningless on templates; the
    # request's bucket comes through the cached bucket-spend read.

  @unit
  Scenario: An unreadable bucket figure allows rather than blocks
    Given the bucket-spend read fails or no reader is wired
    When a request with an end-user id is prechecked
    Then the template does not block the request
    # Permissive on error, matching every other stale-data path on the
    # precheck; never permissive on a missing id, which was already
    # rejected before any read.

  # ────────────────────────────────────────────────────────────────────────────
  # Metering
  # ────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: Attributed debits ride the spend pipeline, not the trace fold
    Given an admitted request carrying an end-user id and a confirmed outcome
    When the gateway-debits process consumes the pair
    Then it freezes one write-debits intent joining who with how much
    And the intent carries the team and principal the ingest seam resolved

  @unit
  Scenario: One writer owns every scope a request debits
    Given a request admitted without an end-user id
    When its outcome is consumed
    Then it still commits one debit intent for its remaining scopes
    # An anonymous request owes its organization, team, project, key,
    # principal and group caps. Only the per-seat templates need an end
    # user, and without one they simply do not resolve.

  @integration
  Scenario: One request's rows for two budgets never suppress each other
    Given a request whose per-seat template and key cap resolve different buckets
    When the writer inserts that request's rows for both
    Then both budgets' rows exist in the ledger
    And replaying the same request inserts nothing new
    # The ledger keys rows by request and budget with no bucket in the
    # key. A whole-request probe would let the second budget's row skip
    # silently, so the writer probes per budget instead.

  @unit
  Scenario: An outcome that outruns its admission still debits
    Given a confirmed outcome consumed before its admit event
    When the admission arrives
    Then the debit intent is committed then, carrying that attribution
    And an admission naming no end user still debits every other scope

  @integration
  Scenario: A debit that would land in a different bucket is never quiet
    Given a row already on this request for the same budget
    When that budget is inserted again against a different bucket
    Then the suppressed debit is reported at error with its request id

  # ────────────────────────────────────────────────────────────────────────────
  # Reads
  # ────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: The end-user spend endpoint returns spend and the applicable cap together
    Given a template and recorded spend for one end user
    When the end-user spend endpoint is asked about that user
    Then it returns the bucket's current spend and the template's limit
    # The pair a rebilling platform polls at period close, replacing the
    # incumbent's per-customer info call.

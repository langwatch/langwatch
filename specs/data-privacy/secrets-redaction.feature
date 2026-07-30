Feature: Redacting secrets from traces
  As any LangWatch customer
  I want API keys, tokens, and connection strings scrubbed out of my traces
  automatically
  So that credentials in coding-agent traces never get stored in the clear

  # Secrets redaction is on by default for every project - customers stream
  # Claude Code and coding-agent traces full of live credentials, so the safe
  # default is to scrub them. It runs natively in the ingestion pipeline (no
  # external service) by matching well-known secret shapes (cloud keys, provider
  # API keys, JWTs, private-key blocks, database URLs) and obviously-sensitive
  # attribute names. A team can extend it with their own patterns or, if they
  # accept the risk, turn it off. Detected secrets are replaced with a redaction
  # placeholder; the surrounding text is preserved.

  Background:
    Given an organization "acme" with a project "web-app"

  @integration
  Scenario: A leaked provider API key is redacted with no configuration
    Given no privacy rule exists for "web-app"
    When a trace is ingested whose input contains an OpenAI API key
    Then the stored input has the API key redacted

  @integration
  Scenario: A database connection string is redacted
    When a trace is ingested whose input contains a "postgres://" connection string with a password
    Then the stored input has the connection string redacted

  @integration
  Scenario: A value under an obviously-sensitive attribute name is redacted
    When a trace is ingested with an attribute named "authorization" carrying a bearer token
    Then the stored "authorization" attribute is redacted

  @integration
  Scenario: A custom pattern redacts a company-specific secret
    Given a rule on "web-app" that adds a custom secret pattern for internal tokens shaped like "acme_live_..."
    When a trace is ingested whose input contains an "acme_live_" token
    Then the stored input has the token redacted

  @integration
  Scenario: A team can disable secrets redaction on purpose
    Given a rule on "web-app" that turns secrets redaction off
    When a trace is ingested whose input contains an API key
    Then the stored input still contains the API key

  @integration
  Scenario: Secrets redaction leaves ordinary text intact
    When a trace is ingested whose input is an ordinary sentence with no secrets
    Then the stored input is unchanged

  @integration
  Scenario: An unsafe custom pattern is rejected when saving the rule
    When an admin tries to save a custom secret pattern that is a catastrophic-backtracking regex
    Then the request is rejected with a validation error

  # The OTLP receiver stamps ingestion-key traces with provenance attributes,
  # among them the opaque id of the ingestion key row, never the key material,
  # overwriting anything the client sent under that name. That id lives under
  # "langwatch.ingest_key_id", a name chosen to clear two separate filters it
  # would otherwise die in. It is not "langwatch.api_key.id", which the
  # sensitive-attribute-name deny-list nukes on "api_key". It is also not under
  # "langwatch.reserved.", which the ingestion pipeline strips wholesale and the
  # facet list hides. So the stamped id stays readable with no exemption carved
  # into either filter. This also means "langwatch.api_key.id" itself carries no
  # receiver-stamped guarantee and is fully covered by the deny-list for
  # anything a client sends under that name, ingestion traffic or not.
  @integration
  Scenario: The receiver-stamped ingestion key id stays readable
    When a trace is ingested with a resource attribute "langwatch.ingest_key_id" carrying an opaque key id
    Then the stored "langwatch.ingest_key_id" attribute still contains the key id

  @integration
  Scenario: Real key material under the ingestion key id attribute is still redacted
    When a trace is ingested with a resource attribute "langwatch.ingest_key_id" carrying an "sk-lw-" API key
    Then the stored "langwatch.ingest_key_id" attribute is redacted

  # A name under "langwatch.reserved." would be dropped by recordSpanCommand
  # before it ever reached storage, turning a redacted-but-present id into a
  # missing one and logging a warning on every ingest-key trace.
  @unit
  Scenario: Receiver-stamped ingestion key id survives the reserved strip
    When the receiver has stamped ingest-key provenance onto a span's resource
    Then every stamped provenance attribute is still on the span the pipeline emits

  @integration
  Scenario: A non-ingestion trace can never retain an arbitrary value under the old key id attribute name
    When a trace is ingested with a resource attribute "langwatch.api_key.id" carrying an arbitrary value
    Then the stored "langwatch.api_key.id" attribute is redacted

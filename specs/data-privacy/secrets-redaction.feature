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

  # Coverage beyond the known-vendor list.
  #
  # Redaction started as a fixed allow-list of well-known credential shapes.
  # A customer report showed a live third-party key, pasted into a coding-agent
  # prompt, surviving ingestion and rendering in the clear in the trace drawer,
  # because that vendor's prefix was not on the list. An allow-list can never
  # keep up with the long tail of vendors, so redaction also matches on shape
  # (a vendor-style prefix followed by a high-entropy body) and on context (a
  # credential named in the text and then given a value).
  #
  # The negative scenarios below are load-bearing, not decoration. Over-redaction
  # is a bug of the same severity as a leak: the terminal replay and the trace
  # explorer are worth nothing if the product's own output comes back as
  # placeholders. Identifiers, hashes, timestamps and model names must survive.

  @unit
  Scenario: A key from a vendor with no built-in rule is redacted on shape alone
    Given a coding-agent prompt containing an API key from a vendor nobody added to the list
    When the text is redacted
    Then the key is replaced with the redaction placeholder
    And the rest of the sentence is preserved

  @unit
  Scenario: Widely used vendor credentials are redacted
    When text containing credentials from commonly used developer services is redacted
    Then each credential is replaced with the redaction placeholder

  @unit
  Scenario: A credential introduced by name in free text is redacted
    Given a prompt that names a credential in prose and then gives its value
    When the text is redacted
    Then the value is replaced with the redaction placeholder
    And the words introducing it stay readable

  @unit
  Scenario: Ordinary identifiers are never mistaken for secrets
    Given text containing commit hashes, unique identifiers, trace identifiers, timestamps, file paths, model names, package versions and ordinary prose
    When the text is redacted
    Then nothing is replaced

  @unit
  Scenario: A placeholder standing in for a credential stays readable
    Given documentation text where a credential is written as a placeholder or an environment variable reference
    When the text is redacted
    Then the placeholder is left as written

  @unit
  Scenario: One credential is reported as one leak
    Given a prompt where a credential is both named in prose and recognisable by shape
    When the text is scanned without redacting
    Then a single leak is reported

  @unit
  Scenario: A large payload is scanned within the ingestion budget
    Given a payload as large as the ingestion pipeline accepts
    When the text is redacted
    Then the scan completes well inside the ingestion budget

  # The other half of the same design flaw.
  #
  # When the built-in rules were narrow, teams wrote their own patterns to cover
  # the gap, and a hand-written pattern was accepted exactly as typed. A pattern
  # meaning "a key starting with sk-" also matches the middle of "task-", and a
  # trailing wildcard runs to the end of the line, so ordinary transcript text
  # was stored with the rest of the line replaced by a placeholder. That is
  # irreversible: the original text is gone at ingestion.
  #
  # A custom pattern now matches only at a word boundary and stops at the first
  # space or bracket. Both are what the author meant; neither weakens the
  # pattern against the credential it was written for.

  @unit
  Scenario: A custom pattern does not fire inside an ordinary word
    Given a rule on "web-app" whose custom pattern matches tokens starting with "sk-"
    When a trace is ingested containing the words "task-notification" and "risk-based"
    Then the stored text still reads "task-notification" and "risk-based"

  @unit
  Scenario: A custom pattern does not swallow the rest of the line
    Given a rule on "web-app" whose custom pattern ends in a wildcard
    When a trace is ingested whose line holds a credential followed by ordinary words
    Then only the credential is replaced and the words after it survive

  @unit
  Scenario: A custom pattern still redacts the credential it was written for
    Given a rule on "web-app" whose custom pattern matches tokens starting with "sk-"
    When a trace is ingested whose input contains a provider key
    Then the stored input has the key redacted

  # "langwatch.api_key.id" carries the id of the ApiKey row that authenticated
  # the request, never the key material. The sensitive-attribute-NAME deny-list
  # matches "api_key" and was nuking it to [SECRET], hiding the one field that
  # says which key produced a trace, so that exact name is exempt from the name
  # rule.
  #
  # An attribute name is caller-supplied, so an exemption on its own would be a
  # free slot to park a real secret in. What makes it safe is that the value can
  # never come from the payload: every authenticated OTLP request has the
  # attribute rewritten from the authenticated identity, with any payload copy
  # dropped first at resource, span, event and link level. No other ingestion
  # path can even produce this attribute name, because they build attributes
  # from a fixed key set. So at redaction time the value is receiver-written or
  # absent, and the exemption is safe by construction rather than by trust.
  @unit
  Scenario: A caller cannot forge the API key id attribute
    Given a trace whose payload sets "langwatch.api_key.id" to a value of its own choosing
    When the request authenticates as an ordinary project API key
    Then the stored attribute holds the id of the key that authenticated, not the submitted value

  @unit
  Scenario: Legacy project key auth leaves no API key id behind
    Given a trace whose payload sets "langwatch.api_key.id" to a value of its own choosing
    When the request authenticates as a legacy project key, which has no ApiKey row
    Then the submitted value is dropped and no API key id attribute is stored

  @integration
  Scenario: The receiver-written API key id stays readable
    When a trace is ingested with a resource attribute "langwatch.api_key.id" carrying an opaque key id
    Then the stored "langwatch.api_key.id" attribute still contains the key id

  @integration
  Scenario: Real key material under the API key id attribute is still redacted
    When a trace is ingested with a resource attribute "langwatch.api_key.id" carrying an "sk-lw-" API key
    Then the stored "langwatch.api_key.id" attribute is redacted

  # The pipeline strips whole attribute namespaces, so a provenance name that
  # lands in one is deleted between the receiver writing it and storage.
  @unit
  Scenario: The receiver-written API key id survives the ingestion pipeline
    When the receiver has written ingest provenance onto a span's resource
    Then the API key id is still on the span the pipeline emits

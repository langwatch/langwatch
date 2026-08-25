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

  # A connection string is the one secret that is only partly secret. The
  # password goes and the rest stays, because a reader needs to know which
  # database the trace was talking to. Schemes are written in many shapes, and
  # an address or a bare "://" in prose is not a connection string at all.

  @unit
  Scenario: A connection URL keeps its scheme whatever shape the scheme has
    Given connection strings whose schemes carry digits, dots and plus signs
    When the text is redacted
    Then only the password is replaced and each scheme is kept

  @unit
  Scenario: Text that only looks like a connection URL is left alone
    Given text with a "://" that no scheme introduces, and an address with an at sign
    When the text is redacted
    Then the text is unchanged

  @unit
  Scenario: A reported connection URL spans the whole URL
    Given a connection string with a password in it
    When the text is scanned without redacting
    Then the reported leak covers the URL from its scheme onwards

  # Text past the scan budget used to be returned untouched, which was a bypass
  # rather than a budget: a real agent input of nearly a megabyte carried a live
  # provider key through ingestion completely unscanned, and being oversized was
  # a reliable way to smuggle one past redaction. It is sliced now, so the cost
  # per pass stays bounded and no region goes unscanned.

  @unit
  Scenario: A credential straddling a slice boundary is still redacted
    Given a payload larger than the scan budget with a credential on the boundary
    When the text is redacted
    Then the credential is replaced rather than split across two slices

  @unit
  Scenario: A PEM block straddling a slice boundary is still redacted
    Given a payload larger than the scan budget with a PEM block on the boundary
    When the text is redacted
    Then the block is replaced whole

  @unit
  Scenario: A payload past the scan budget is still scanned
    Given a payload larger than the scan budget with a credential inside it
    When the text is redacted
    Then the credential is replaced wherever in the payload it sits

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
  # whitespace, quote, backtick or angle bracket. Both are what the author
  # meant; neither weakens the pattern against the credential it was written
  # for.

  @unit
  Scenario: A custom pattern does not fire inside an ordinary word
    Given a custom pattern that matches tokens starting with "sk-"
    When text containing the words "task-notification" and "risk-based" is redacted
    Then the text still reads "task-notification" and "risk-based"

  @unit
  Scenario: A custom pattern does not swallow the rest of the line
    Given a custom pattern that ends in a wildcard
    When a line holding a credential followed by ordinary words is redacted
    Then only the credential is replaced and the words after it survive

  # Three shapes the matching layers missed. Our own `ik-lw-` ingest keys were
  # covered by nothing at all and `sk-lw-` only once the body reached the
  # generic rule's 20-character floor, so both are known prefixes now and match
  # on the prefix plus three body characters rather than a full-length body. An
  # all-hex body was refused by the character-mix gate, which is right for a
  # bare hex run (a commit, a trace id and a digest are the same shape) and
  # wrong when the token names itself a credential, so a hex body is accepted
  # only behind a credential segment and never behind an identifier prefix. And the shape rule read lowercase
  # prefixes only, which missed every vendor minting `LW_`-style keys; the
  # entropy and character-mix gates are what keep a bare environment variable
  # name readable.

  @unit
  Scenario: A key minted by LangWatch is redacted on its prefix
    Given a token carrying one of the prefixes the app mints
    When the text is redacted
    Then the token is redacted without needing a full-length body

  @unit
  Scenario: A vendor-prefixed key with an all-hex body is redacted
    Given a token whose prefix names it a credential and whose body is all hexadecimal
    When the text is redacted
    Then the token is redacted

  @unit
  Scenario: An identifier with an all-hex body is left alone
    Given a commit or trace identifier with an all-hex body
    When the text is redacted
    Then the identifier is left as written

  # A second pass over the vendor list, from a sweep of what real payloads
  # carry. `vk-lw-` is ours and was reaching only the generic shape rule, so it
  # survived on a short body. `PGP PRIVATE KEY BLOCK` broke the PEM anchor on
  # its own suffix. The non-Bearer Authorization schemes are ordinary words, so
  # they count only inside an actual Authorization header: a sentence containing
  # "token" is not a credential.
  #
  # PostHog's `phc_` goes the other way. It is a client-side project key that
  # ships in published web bundles by design, so it is deliberately NOT
  # redacted; the shape rule had been catching it against the stated intent.

  @unit
  Scenario: Credentials the vendor list had missed are redacted
    Given a credential carrying a vendor prefix, armour or authorization scheme the list had missed
    When the text is redacted
    Then the credential is replaced

  @unit
  Scenario: A key with a standard base64 body is redacted
    Given a prefixed key whose body uses standard base64 rather than base64url
    When the text is redacted
    Then the key is redacted

  @unit
  Scenario: A key with an upper or mixed case prefix is redacted
    Given a high-entropy token whose prefix is upper or mixed case
    When the text is redacted
    Then the token is redacted

  @unit
  Scenario: An environment variable name is not mistaken for a key
    Given a bare environment variable name
    When the text is redacted
    Then the name is left as written

  # The cue layer was blind twice over. It read attribute names on separators
  # only, so every camelCase and PascalCase name was one opaque word and none of
  # them fired, including AWS Secrets Manager's own `SecretString`. And it
  # accepted only `:` and `=` as a separator, so `Authorization <token>` was
  # missed. Whitespace is accepted now on a higher bar: the value has to look
  # like key material in its own right, because accepting it on the same terms
  # as `:` matched thousands of ordinary sentences.
  #
  # Bare `key` and `token` still need a qualifying word in front, so an
  # `idempotency_key` and a count of `input_tokens` stay readable.

  @unit
  Scenario: A camelCase credential name is recognised
    Given an attribute whose camelCase name says it holds a credential
    When the name is checked
    Then it is recognised as sensitive

  @unit
  Scenario: An ordinary name containing key or token is not a credential
    Given an attribute named for an identifier or a count
    When the name is checked
    Then it is not treated as sensitive

  @unit
  Scenario: A credential after a whitespace separator is redacted
    Given a credential word followed by key material with only a space between
    When the text is redacted
    Then the credential is replaced

  @unit
  Scenario: Prose following a credential word is left alone
    Given an ordinary sentence containing a credential word
    When the text is redacted
    Then the sentence is left as written

  # `key` names a map entry at least as often as a credential, and JSON
  # payloads, OTLP attributes and config dictionaries are full of `key` fields
  # holding ids and hashes. Treating the bare word as proof of a credential
  # destroyed those values at ingestion, and destroyed them only there: the same
  # id on its own was correctly kept.

  @unit
  Scenario: A bare key field holding an identifier is left alone
    Given a map entry whose name is key and whose value is an identifier
    When the text is redacted
    Then the identifier is left as written

  @unit
  Scenario: A qualified key name is still a credential
    Given a credential word qualifying key, followed by key material
    When the text is redacted
    Then the credential is replaced

  # Span content arrives JSON-encoded, so a literal two-character escape sits
  # inside the text. A value allowed to run through one crossed logical lines
  # and slipped past the guards that recognise an environment reference.

  @unit
  Scenario: A JSON-escaped newline does not extend a credential value
    Given a payload where a credential word is followed by an environment reference and an escaped newline
    When the text is redacted
    Then the environment reference is left as written

  # Catching it at authorship as well as at match time. An over-broad secret
  # pattern used to be waved through on the reasoning that it "only
  # over-redacts", but redaction runs at ingestion and rewrites the text for
  # good, so it is data loss. The same probe answers the settings page and the
  # server, so the warning a customer reads is the behaviour they would get.

  @unit
  Scenario: A pattern that would match ordinary text is reported as too broad
    Given a candidate custom pattern that matches ordinary prose
    When the pattern is checked
    Then it reports the ordinary text it would erase

  @integration
  Scenario: An over-broad custom secret pattern is rejected when saving the rule
    When an admin tries to save a custom secret pattern that also matches ordinary text
    Then the request is rejected with a validation error
    And no rule is stored

  @unit
  Scenario: A custom pattern still redacts the credential it was written for
    Given a custom pattern that matches tokens starting with "sk-"
    When text containing a provider key is redacted
    Then the key is redacted

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

  # Everything above describes the span path. The log and metric pipelines
  # flatten a decoded payload into one record keyed by a JSON path, because two
  # attributes may share a name and each value still needs its own address. A
  # path can never satisfy a rule written against an attribute NAME, so those
  # rules never ran on those pipelines: a credential-named attribute was left to
  # the value-shape rules, and a plain-text one survived them. The name travels
  # beside the path now, which both closes that gap and makes the exemption
  # apply on purpose rather than by accident.

  @unit
  Scenario: A credential-named log attribute is redacted by name
    Given a log attribute named as a credential whose value is ordinary text
    When the log record is redacted
    Then the value is replaced

  @unit
  Scenario: The receiver-written API key id survives redaction on the log path
    Given a log attribute holding the receiver-written API key id
    When the log record is redacted
    Then the key id is still readable

  # The shape rule reads the prefix up to the FIRST separator, and the record
  # id list held `scenario` while the product mints `scenariorun_…`. The rule
  # saw `scenariorun`, matched nothing on the list, and blanked every
  # simulation run id at ingestion; `prompt_…`, `scenarioset_…`, `check_…`,
  # `dataset_…` and `trigger_…` went the same way, and `scenariobatch_…`
  # survived only by being one character over the prefix cap. A customer report
  # showed the cost of it: with the run id gone, a trace could not be attached
  # to its run, and the pipeline attributed the cost to a run that did not
  # exist. Redaction is irreversible at ingestion, so the ids are not
  # recoverable for the spans already stored.
  #
  # The prefixes the app mints are listed one by one now, and the test walks
  # the app's own resource registry, so a resource added later cannot be
  # forgotten here.
  #
  # A prefix on its own is too weak a signal to exempt a token on, because the
  # words the product mints ids under - `agent`, `prompt`, `record`, `dataset`,
  # `event` - are the words an unlisted vendor mints a token under too. So the
  # whole token has to look like an id the product minted: the prefix names the
  # record and the body carries the format the product writes, a fixed-length
  # base62 string. A vendor token that borrows the prefix has a body of the
  # wrong length and is still replaced.

  @unit
  Scenario: Every id prefix the product mints survives redaction
    Given an id for every resource the application mints ids for
    When each id is redacted
    Then every id is left exactly as written

  @unit
  Scenario: A credential that borrows a product id prefix is still redacted
    Given a credential-shaped token whose prefix names a product record
    And the token body is not the format the product mints
    When the token is redacted in text that names no credential
    Then the token is replaced

  # Second line for the same failure. Two rules decide on shape alone: they ask
  # only whether a token looks random, and a minted id looks as random as a
  # minted key, so a rule tuned for keys will take ids again. For the small set
  # of attribute names the ingestion pipeline READS - the run id it attaches a
  # trace by, the prompt id, the conversation, user and customer it groups by,
  # the gateway and ingestion provenance - the value is an address rather than
  # content, so those two rules are left out by name.
  #
  # Only those two. An exemption that turned the secrets pass off would trade
  # one hole for a worse one, because a real key parked under a run id would
  # then be stored in the clear. Every rule that reads a vendor prefix, armour,
  # a URL password, an authorization scheme or a credential keyword still runs,
  # so does the sensitive-name rule, so do the customer's own patterns, and so
  # does the personal-data pass. None of them can match a minted record id,
  # which carries no vendor prefix and no keyword in front of it.

  @unit
  Scenario: A reserved identifier attribute keeps its value
    Given a span attribute the pipeline reads to link a trace, holding an id
    When the attribute is redacted with secrets redaction on
    Then the stored attribute still holds the id

  @unit
  Scenario: A credential under a reserved identifier attribute is still redacted
    Given a reserved attribute holding a real vendor credential
    When the attribute is redacted
    Then the credential is replaced

  @unit
  Scenario: A custom secret pattern still runs on a reserved identifier attribute
    Given a rule that adds a custom secret pattern
    When a reserved attribute holds a value that pattern matches
    Then the value is replaced

  @unit
  Scenario: The sensitive name rule still runs on a reserved identifier attribute
    Given a reserved attribute whose name the deny-list matches
    When the attribute is redacted
    Then the value is replaced by name

  @unit
  Scenario: A name that only resembles a reserved one is still redacted
    Given an attribute whose name adds a prefix or a suffix to a reserved name
    When the attribute is redacted
    Then the value is treated as ordinary content

  @unit
  Scenario: A reserved identifier attribute still runs the personal data pass
    Given a reserved attribute whose value is an email address
    When the attribute is redacted
    Then the email address is replaced

  @integration
  Scenario: A simulation trace keeps the run id that links it to its run
    When a trace is ingested with a span attribute "scenario.run_id"
    Then the stored span still carries the run id

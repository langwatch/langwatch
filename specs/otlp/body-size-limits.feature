Feature: Body size limits on ingestion endpoints

  Ingestion endpoints cap how many bytes they will hold, so a single oversized
  upload cannot exhaust the process. The cap is a refusal, not a crash, and it
  applies the same way whether or not the sender declared how much it was about
  to send.

  Declaring a length is optional. A sender that streams cannot know the size in
  advance, and Node's HTTP client omits the header by default, so the
  OpenTelemetry JS exporter and anything built on it arrive chunked. An
  endpoint that only works for senders who declare a length works in a browser
  and behind a buffering proxy, and fails for the SDKs we ship.

  Rule: A body under the cap reaches its handler

    @unit
    Scenario: A sender that declares its length is served
      Given an ingestion route with a body size cap
      When a request arrives declaring a length under the cap
      Then the handler receives the whole body

    @unit
    Scenario: A sender that declares no length is served
      Given an ingestion route with a body size cap
      When a request arrives with no declared length and a body under the cap
      Then the handler receives the whole body
      # The regression: this answered 500 instead, because measuring an
      # undeclared body meant rebuilding the request, and the rebuild rejected
      # the server adapter's own request object.

  Rule: A body over the cap is refused

    @unit
    Scenario: A declared length over the cap is refused before the body is read
      Given an ingestion route with a body size cap
      When a request arrives declaring a length over the cap
      Then it is refused as too large

    @unit
    Scenario: An undeclared body is refused once it passes the cap
      Given an ingestion route with a body size cap
      When a request arrives with no declared length and a body over the cap
      Then it is refused as too large

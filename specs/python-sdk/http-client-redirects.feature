Feature: Python SDK HTTP client redirects
  As a Python SDK user who sets LANGWATCH_ENDPOINT
  I want every request the SDK sends to LangWatch to go through one HTTP client
  So that an http endpoint still works and any other redirect fails where I can read it

  Background: one client, one rule.
    Every request the SDK sends to the LangWatch API, from the generated
    OpenAPI client and from every hand written call, goes through
    `langwatch.http_client`. httpx never follows a redirect on its own there.
    The SDK follows exactly one kind of redirect: a 301, 302, 307 or 308
    whose Location is the same URL with the scheme changed from http to
    https. Same host, same port (an absent port is the scheme default), same
    path, same query; the fragment is ignored. The replay keeps the method,
    the headers and the body bytes. Every other redirect raises
    `RedirectRefusedError`, which carries the request URL, the Location value
    and the status. OpenTelemetry's own exporter keeps its own HTTP stack and
    is outside this rule.

  # --- The upgrade that is followed ---

  @unit
  Scenario: follows a redirect that only upgrades http to https
    Given a client whose endpoint answers http with a 301 to the same https URL
    When the SDK sends a request to the http URL
    Then the caller receives the https response
    And the transport sent exactly two requests

  @unit
  Scenario: replays the same method, headers and body on the upgrade
    Given a client whose endpoint answers http with a 307 to the same https URL
    When the SDK sends a POST with an Authorization header and a JSON body
    Then the https request carries the same method, the same headers and the same body bytes

  @unit
  Scenario: warns once per process about an http endpoint
    Given a client whose endpoint upgrades http to https
    When the SDK sends two requests to the http URL
    Then one warning names the http endpoint and the https endpoint to set
    And the second upgrade logs no warning

  # --- Redirects that are refused ---

  @unit
  Scenario: refuses a redirect to another host
    Given a client whose endpoint answers with a 301 to a different host
    When the SDK sends a request
    Then the call raises RedirectRefusedError with the request URL, the Location and the status
    And the error message tells the caller to set the endpoint to the final URL

  @unit
  Scenario: refuses a redirect that changes the path or query
    Given a client whose endpoint answers with a 308 to the https URL with another path
    And a client whose endpoint answers with a 308 to the https URL with another query
    When the SDK sends a request to each
    Then each call raises RedirectRefusedError

  @unit
  Scenario: refuses a downgrade from https to http
    Given a client whose endpoint answers https with a 301 to the same http URL
    When the SDK sends a request to the https URL
    Then the call raises RedirectRefusedError

  @unit
  Scenario: refuses a 303
    Given a client whose endpoint answers http with a 303 to the same https URL
    When the SDK sends a request
    Then the call raises RedirectRefusedError with status 303

  @unit
  Scenario: refuses a second redirect after the upgrade
    Given a client whose endpoint upgrades http to https and then redirects again
    When the SDK sends a request to the http URL
    Then the call raises RedirectRefusedError naming the https URL as the request URL

  @unit
  Scenario: refuses a redirect without a location
    Given a client whose endpoint answers with a 301 and no Location header
    When the SDK sends a request
    Then the call raises RedirectRefusedError with no location

  # --- Every request goes through the shared client ---

  @unit
  Scenario: the generated API client uses the shared transport
    Given the SDK client is set up with an api key and an endpoint
    When the generated REST client builds its sync and async httpx clients
    Then both carry the scheme upgrade transport and never follow redirects on their own

  @unit
  Scenario: every hand written request uses the shared transport
    Given the SDK source tree outside the generated client and the shared module
    When the source is scanned for raw httpx client constructions and module level httpx calls
    Then none are found

Feature: Python SDK HTTP client redirects
  As a Python SDK user who sets LANGWATCH_ENDPOINT
  I want every request the SDK sends to LangWatch to go through one HTTP client
  So that an http endpoint still works and any other redirect fails where I can read it

  Background: one client, one rule per method.
    Every request the SDK sends to the LangWatch API, from the generated
    OpenAPI client and from every hand written call, goes through
    `langwatch.http_client`. httpx never follows a redirect on its own there.
    A GET or HEAD follows a 301, 302, 303, 307 or 308 with the same method,
    up to five hops. A hop that keeps the origin, or only upgrades http to
    https on the same host and port, keeps every header; any other hop drops
    Authorization, X-Auth-Token and X-Project-Id first. A hop from https to
    http is refused. Every other method follows exactly one redirect: a 301,
    302, 307 or 308 whose Location is the same URL with the scheme changed
    from http to https. Same host, same port (an absent port is the scheme
    default), same path, same query; the fragment is ignored. The replay
    keeps the method, the headers and the body bytes. Every refused redirect
    raises `RedirectRefusedError`, which carries the request URL, the
    Location value and the status. OpenTelemetry's own exporter keeps its own
    HTTP stack and is outside this rule.

  # --- The upgrade every method follows ---

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

  # --- What a GET or HEAD follows ---

  @unit
  Scenario: a GET follows a redirect to another path
    Given a client whose endpoint answers a GET with a 301 to another path on the same host
    When the SDK sends the GET
    Then the transport sent a second GET to the new path
    And the caller receives the response of the new path

  @unit
  Scenario: a GET follows a chain of redirects up to five hops
    Given a client whose endpoint answers a GET with five redirects in a row and then a 200
    When the SDK sends the GET
    Then the transport sent six requests, each one a GET
    And the caller receives the final 200

  @unit
  Scenario: a GET refuses a sixth hop
    Given a client whose endpoint answers a GET with six redirects in a row
    When the SDK sends the GET
    Then the call raises RedirectRefusedError naming the fifth target, the sixth Location and its status
    And the transport sent six requests

  @unit
  Scenario: a GET keeps its headers on a same origin redirect
    Given a client whose endpoint answers a GET with a 302 to another path on the same origin
    When the SDK sends the GET with Authorization, X-Auth-Token, X-Project-Id and X-Trace headers
    Then the second request carries every header of the first

  @unit
  Scenario: a GET drops credential headers on a cross origin redirect
    Given a client whose endpoint answers a GET with a 302 to another host
    When the SDK sends the GET with Authorization, X-Auth-Token, X-Project-Id and X-Trace headers
    Then the second request carries X-Trace and the new Host and none of the credential headers

  @unit
  Scenario: a GET refuses a downgrade from https to http
    Given a client whose endpoint answers a https GET with a 301 to the same http URL
    When the SDK sends the GET to the https URL
    Then the call raises RedirectRefusedError
    And the transport sent one request

  @unit
  Scenario: a GET follows a 303
    Given a client whose endpoint answers a GET with a 303 to another path
    When the SDK sends the GET
    Then the transport sent a second GET to the new path

  @unit
  Scenario: a HEAD follows a redirect like a GET
    Given a client whose endpoint answers a HEAD with a 301 to another path
    When the SDK sends the HEAD
    Then the transport sent a second HEAD to the new path

  # --- What every other method refuses ---

  @unit
  Scenario: a POST refuses a redirect to another host
    Given a client whose endpoint answers a POST with a 301 to a different host
    When the SDK sends the POST
    Then the call raises RedirectRefusedError with the request URL, the Location and the status
    And the error message tells the caller to set the endpoint to the final URL

  @unit
  Scenario: a POST still refuses a redirect to another path
    Given a client whose endpoint answers a POST with a 308 to the https URL with another path
    And a client whose endpoint answers a POST with a 308 to the https URL with another query
    When the SDK sends a POST to each
    Then each call raises RedirectRefusedError

  @unit
  Scenario: a POST refuses a downgrade from https to http
    Given a client whose endpoint answers a https POST with a 301 to the same http URL
    When the SDK sends the POST to the https URL
    Then the call raises RedirectRefusedError

  @unit
  Scenario: a POST refuses a 303
    Given a client whose endpoint answers a http POST with a 303 to the same https URL
    When the SDK sends the POST
    Then the call raises RedirectRefusedError with status 303

  @unit
  Scenario: a POST refuses a second redirect after the upgrade
    Given a client whose endpoint upgrades a POST from http to https and then redirects again
    When the SDK sends the POST to the http URL
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

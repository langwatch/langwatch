Feature: TypeScript SDK HTTP client redirects
  As a developer pointing the SDK at LangWatch with an http endpoint
  I want every request to reach the API over https without losing its body
  So that an endpoint written as http://app.langwatch.ai still records events and any other redirect is an error I can read

  Background:
    Given every request the SDK sends to the LangWatch API goes through the shared langwatchFetch
    And langwatchFetch sends with redirects disabled and inspects the response itself

  @unit
  Scenario: follows a redirect that only upgrades http to https
    Given the endpoint is "http://app.langwatch.ai"
    And the platform answers a request with a 301 whose Location is the same URL over https
    When the SDK sends the request
    Then the request is sent again to the https URL
    And the caller receives the https response

  @unit
  Scenario: replays the same method, headers and body on the upgrade
    Given a POST with an Authorization header and a JSON body
    And the platform answers with a 307 to the same URL over https
    When the SDK sends the request
    Then the https request carries the same method, the same headers and the same body bytes

  @unit
  Scenario: warns once per process about an http endpoint
    Given two requests to "http://app.langwatch.ai" that are both upgraded
    When both complete
    Then the SDK logger warns exactly once
    And the warning names "https://app.langwatch.ai" as the endpoint to configure

  @unit
  Scenario: refuses a redirect to another host
    Given the platform answers with a 301 to "https://other.example.com" on the same path
    When the SDK sends the request
    Then the request fails with a LangWatchRedirectError carrying the request URL, the Location and the status
    And the error message asks to set the endpoint to the final URL
    And no second request is sent

  @unit
  Scenario: refuses a redirect that changes the path or query
    Given the platform answers with a 308 to the same host over https on a different path or query
    When the SDK sends the request
    Then the request fails with a LangWatchRedirectError
    And no second request is sent

  @unit
  Scenario: refuses a downgrade from https to http
    Given the endpoint is "https://app.langwatch.ai"
    And the platform answers with a 301 to the same URL over http
    When the SDK sends the request
    Then the request fails with a LangWatchRedirectError

  @unit
  Scenario: refuses a 303
    Given the platform answers with a 303 to the same URL over https
    When the SDK sends the request
    Then the request fails with a LangWatchRedirectError

  @unit
  Scenario: refuses a second redirect after the upgrade
    Given the platform answers the http request with a 301 to the same URL over https
    And the https request is answered with another redirect
    When the SDK sends the request
    Then the request fails with a LangWatchRedirectError carrying the https URL and the second Location
    And no third request is sent

  @unit
  Scenario: refuses a redirect without a location
    Given the platform answers with a 302 and no Location header
    When the SDK sends the request
    Then the request fails with a LangWatchRedirectError whose location is empty

  @unit
  Scenario: refuses an opaque redirect
    Given the runtime hides the redirect target behind an opaque redirect response
    When the SDK sends the request
    Then the request fails with a LangWatchRedirectError with status 0

  @unit
  Scenario: refuses to replay a streaming body
    Given a POST whose body is a ReadableStream
    And the platform answers with a 307 to the same URL over https
    When the SDK sends the request
    Then the request fails with a LangWatchRedirectError
    And no second request is sent

  @unit
  Scenario: the generated API client uses the shared transport
    Given the OpenAPI client is created for "http://app.langwatch.ai"
    And the platform answers with a 301 to the same URL over https
    When a request is made through the client
    Then the https request carries the client's authentication headers
    And the caller receives the https response body

  @unit
  Scenario: every hand written request uses the shared transport
    Given the SDK source outside tests and generated code
    When it is scanned for direct fetch calls and fetch defaults
    Then every file that talks to the LangWatch API uses langwatchFetch
    And only calls to other servers, a tunnel, a user's own agent or the docs site, use fetch directly

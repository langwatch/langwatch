Feature: The image proxy shows a picture from an outside address
  Trace and dataset views show pictures that live on other sites through GET /api/image-proxy?url=,
  fetched behind the deployment's egress fence and answered with main's statuses and bodies.
  Only a signed-in browser reaches it; the app's own pictures send the session cookie.

  @integration
  Scenario: the image proxy refuses a caller who is not signed in
    Given a browser with no session
    When it asks the image proxy for an outside address
    Then it answers 401 "unauthorized"
    And the outside address is never fetched

  @unit
  Scenario: the image proxy records the host it fetched from, never the full address
    Given an outside address whose path and query carry private detail
    When a signed-in browser asks the image proxy for it, and the picture is relayed or refused
    Then the proxy logs one line naming the host and the status
    And the line holds neither the path nor the query

  @integration
  Scenario: the image proxy serves a picture with a year-long cache
    Given an outside address that answers with a PNG picture
    When a signed-in browser asks the image proxy for that address
    Then it answers 200 with the picture's own media type and "private, max-age=31536000"
    And the answer carries stored-object's read headers, so the picture cannot run as a page

  @integration
  Scenario: the image proxy refuses a request that names no address
    When a signed-in browser asks the image proxy without a url
    Then it answers 400 with the body {"error":"Missing url"}

  @integration
  Scenario: the image proxy refuses an address that is not a picture
    Given an outside address that answers with an HTML page
    When a signed-in browser asks the image proxy for that address
    Then it answers 400 with the body {"error":"URL does not point to an image"}

  @integration
  Scenario: the image proxy passes on an outside refusal
    Given an outside address that answers 404 Not Found
    When a signed-in browser asks the image proxy for that address
    Then it answers 404 with the body {"error":"Failed to fetch image: Not Found"}

  @integration
  Scenario: the image proxy refuses a picture over the size limit
    Given an outside address that answers with a picture larger than the proxy relays
    When a signed-in browser asks the image proxy for that address
    Then it answers 413 with the body {"error":"Image is too large"}

  @integration
  Scenario: the image proxy answers 500 when the address cannot be reached
    Given an outside address the egress fence refuses
    When a signed-in browser asks the image proxy for that address
    Then it answers 500 with the body {"error":"Failed to fetch image"}

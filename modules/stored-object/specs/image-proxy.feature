Feature: The image proxy shows a picture from an outside address
  Trace and dataset views show pictures that live on other sites through GET /api/image-proxy?url=,
  fetched behind the deployment's egress fence and answered with main's statuses and bodies.

  @integration
  Scenario: the image proxy serves a picture with a year-long cache
    Given an outside address that answers with a PNG picture
    When the browser asks the image proxy for that address
    Then it answers 200 with the picture's own media type and "public, max-age=31536000"
    And the answer carries stored-object's read headers, so the picture cannot run as a page

  @integration
  Scenario: the image proxy refuses a request that names no address
    When the browser asks the image proxy without a url
    Then it answers 400 with the body {"error":"Missing url"}

  @integration
  Scenario: the image proxy refuses an address that is not a picture
    Given an outside address that answers with an HTML page
    When the browser asks the image proxy for that address
    Then it answers 400 with the body {"error":"URL does not point to an image"}

  @integration
  Scenario: the image proxy passes on an outside refusal
    Given an outside address that answers 404 Not Found
    When the browser asks the image proxy for that address
    Then it answers 404 with the body {"error":"Failed to fetch image: Not Found"}

  @integration
  Scenario: the image proxy refuses a picture over the size limit
    Given an outside address that answers with a picture larger than the proxy relays
    When the browser asks the image proxy for that address
    Then it answers 413 with the body {"error":"Image is too large"}

  @integration
  Scenario: the image proxy answers 500 when the address cannot be reached
    Given an outside address the egress fence refuses
    When the browser asks the image proxy for that address
    Then it answers 500 with the body {"error":"Failed to fetch image"}

  @unit
  Scenario: A picture answer carries its own headers over stored-object's read headers
    Given the image service answered with a picture, a status and its own headers
    When the answer is written
    Then the status, bytes and the picture's own headers are kept
    And every other stored-object read header, such as nosniff, is present

  @unit
  Scenario: A picture over the size limit is refused rather than relayed
    Given the image service refused a picture over the size limit
    When the answer is written
    Then it is that status with the error as JSON
    And stored-object's read headers, such as nosniff, are present

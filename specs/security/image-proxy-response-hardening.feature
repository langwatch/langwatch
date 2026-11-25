Feature: Relayed image bytes are inert on the product's own origin
  As a signed-in LangWatch user
  I want an image the product fetched on my behalf to be unable to run script
  So that a link to our own domain cannot take over my session

  `GET /api/image-proxy?url=...` is a public, credential-less door: the URL is
  the caller's, and the bytes that come back are whatever the host at the other
  end chose to send. `image/svg+xml` passes any "is this an image" test and is
  also a document — a browser rendering one at the top level runs its `<script>`
  with the origin's cookies and storage. The deployment's own Content-Security-
  Policy does not cover this response, because it is emitted by the static
  surface only and everything under `/api/` is claimed by the API.

  The stored-object read doors already solved exactly this for bytes out of our
  own bucket. The proxy uses the same helper rather than a second answer to the
  same question: `packages/api/src/rest/media-response.ts`.

  Implementation: apps/api/src/features/image-proxy/image-proxy-rest.ts

  Rule: Relayed bytes carry the stored-object hardening headers

    @unit
    Scenario: Proxied image bytes cannot run script on the product origin
      Given an upstream host that answers with an SVG document
      When a browser loads that image through the proxy
      Then the response is sandboxed by its own content security policy
      And the response forbids media-type sniffing
      And the response leaks no referrer

    @unit
    Scenario: A proxied image keeps its own media type and stays cacheable
      Given an upstream host that answers with a PNG and a charset parameter
      When a browser loads that image through the proxy
      Then the response names the media type without the upstream's parameters
      And the response stays cacheable, because it is addressed by its own URL

    @unit
    Scenario: A proxied filename cannot inject a response header
      Given a requested URL whose last path segment carries quotes and separators
      When a browser loads that image through the proxy
      Then the disposition filename holds only filename-safe characters

    @unit
    Scenario: A proxied response that is not an image is refused
      Given an upstream host that answers with an HTML document
      When a browser loads that URL through the proxy
      Then the request is refused rather than relayed

  Rule: The proxy holds a bounded amount of an outside answer in memory

    The body is read only for a successful picture answer, and only up to a
    fixed size limit. The declared length is checked first, and the bytes are
    counted as they arrive because a host may declare no length or a false one.

    @unit
    Scenario: A picture over the size limit is refused rather than relayed
      Given an upstream host that answers with a picture over the size limit
      When a browser loads that image through the proxy
      Then the request is refused with 413

    @unit
    Scenario: A picture that declares a size over the limit is refused unread
      Given an upstream host that declares a picture larger than the size limit
      When the proxy fetches that picture
      Then the picture is refused from its headers
      And the connection is dropped without reading the body

    @unit
    Scenario: A picture that grows past the limit without declaring a size is cut off
      Given an upstream host that sends a picture with no declared size and never stops
      When the proxy fetches that picture
      Then the picture is refused once the size limit is passed
      And the connection is dropped

    @unit
    Scenario: A response that is not a picture is refused without reading its body
      Given an upstream host that answers with an endless HTML document
      When the proxy fetches that address
      Then the body is not read
      And the connection is dropped

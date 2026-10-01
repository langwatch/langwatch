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

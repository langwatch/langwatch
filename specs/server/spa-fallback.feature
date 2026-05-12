Feature: Production HTTP server — static asset and SPA fallback behavior
  As an operator running the production Hono server behind a CDN
  I want missing /assets/* paths to return real 404s
  So that stale chunk URLs from previous deploys do not poison the CDN
  with HTML responses served under JavaScript MIME types

  # Background: Vite hashes asset filenames per build. After a deploy, browsers
  # holding the previous index.html may request chunk URLs whose files no longer
  # exist on the new image. If the server falls back to index.html (HTML 200) for
  # those paths, a CDN with a "cache everything under /assets/* with immutable
  # TTL" rule will cache the HTML response under the JS URL. Subsequent loads then
  # see strict-MIME violations even after a roll-forward, until the cache is
  # manually purged. The fix: return a real 404 for missing /assets/* so the CDN
  # caches a 404 (or nothing), never an HTML 200.

  Background:
    Given the production server is running with a built client at dist/client
    And dist/client/index.html exists
    And dist/client/assets/index-abc123.js exists with JavaScript content

  Scenario: Existing asset is served with the correct MIME type and immutable cache
    When a client requests /assets/index-abc123.js
    Then the response status is 200
    And the Content-Type header is application/javascript
    And the Cache-Control header is "public, max-age=31536000, immutable"
    And the response body is the on-disk JavaScript content

  Scenario: Missing asset returns a real 404 with no-cache headers
    When a client requests /assets/does-not-exist-xyz.js
    Then the response status is 404
    And the response is not the index.html document
    And the Cache-Control header instructs caches not to store the response

  Scenario: Missing asset returns 404 even though Accept includes text/html
    When a client requests /assets/foo-stale.js with Accept "text/html,*/*"
    Then the response status is 404
    And the response is not the index.html document

  Scenario: Unknown non-asset route falls back to index.html for SPA routing
    When a client requests /projects/foo/traces
    Then the response status is 200
    And the Content-Type header is text/html
    And the response body equals the contents of index.html

  Scenario: Asset path traversal is rejected before touching the filesystem
    When a client requests /assets/../../etc/passwd
    Then the response status is 400

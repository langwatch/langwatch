Feature: Production HTTP server — runtime-configurable CDN asset base
  As an operator running the shared LangWatch image
  I want the base URL for content-hashed assets chosen at container start, not build time
  So that one image serves assets same-origin for self-host and from a
  commit-prefixed CDN for SaaS, and a rolling deploy never strands a tab on a 404

  # Background: Vite hashes asset filenames per build and, before this change,
  # baked an absolute base ("/") into every chunk URL at build time. During a
  # rolling deploy two builds serve behind one Service, so a tab that fetched the
  # HTML shell from build A can have a lazy import() load-balanced to a build-B
  # pod that lacks that hash — a 404. The fix moves asset hosting off the pods:
  # Vite emits every asset URL as `window.__lwAssetUrl(<relative path>)`, and the
  # server injects that resolver into the served HTML shell from LANGWATCH_ASSET_BASE.
  # SaaS points it at https://cdn.langwatch.ai/<commit-sha>/ where every past
  # build's commit-prefixed namespace still exists in S3, so both builds' assets
  # resolve regardless of which pod serves the shell. Self-host leaves it unset
  # and assets resolve same-origin exactly as before. Companion to spa-fallback.feature.

  Rule: The base is normalized so callers never worry about the trailing slash

    Scenario: An unset base means same-origin
      Given LANGWATCH_ASSET_BASE is unset
      When the asset base is resolved
      Then the base is "/"

    Scenario: A bare "/" means same-origin
      Given LANGWATCH_ASSET_BASE is "/"
      When the asset base is resolved
      Then the base is "/"

    Scenario: A CDN base without a trailing slash gains one
      Given LANGWATCH_ASSET_BASE is "https://cdn.langwatch.ai/abc123"
      When the asset base is resolved
      Then the base is "https://cdn.langwatch.ai/abc123/"

    Scenario: A CDN base with a trailing slash is left intact
      Given LANGWATCH_ASSET_BASE is "https://cdn.langwatch.ai/abc123/"
      When the asset base is resolved
      Then the base is "https://cdn.langwatch.ai/abc123/"

  Rule: The served HTML shell always defines the asset-URL resolver

    Scenario: The resolver is injected even when serving same-origin
      Given LANGWATCH_ASSET_BASE is unset
      When a client requests /projects/foo/traces
      Then the response body defines window.__lwAssetUrl
      And the resolver returns "/assets/x.js" for the path "assets/x.js"

    Scenario: Entry script and preload links are rewritten to the CDN base
      Given LANGWATCH_ASSET_BASE is "https://cdn.langwatch.ai/abc123/"
      And dist/client/index.html references /assets/index-deadbeef.js
      When a client requests /
      Then the response body references https://cdn.langwatch.ai/abc123/assets/index-deadbeef.js
      And the resolver returns "https://cdn.langwatch.ai/abc123/assets/x.js" for the path "assets/x.js"

    Scenario: Same-origin rewriting is a no-op for the entry references
      Given LANGWATCH_ASSET_BASE is unset
      And dist/client/index.html references /assets/index-deadbeef.js
      When a client requests /
      Then the response body still references /assets/index-deadbeef.js

    Scenario: The HTML shell is served with a revalidate cache so reloads pick up new hashes
      Given LANGWATCH_ASSET_BASE is "https://cdn.langwatch.ai/abc123/"
      When a client requests /index.html
      Then the Content-Type header is text/html
      And the Cache-Control header instructs caches to revalidate

  Rule: The Content-Security-Policy admits the CDN origin only when one is configured

    Scenario: No CDN origin is added for same-origin serving
      Given LANGWATCH_ASSET_BASE is unset
      When the Content-Security-Policy is built
      Then script-src does not name an external asset origin

    Scenario: The CDN origin is added to the fetch directives
      Given LANGWATCH_ASSET_BASE is "https://cdn.langwatch.ai/abc123/"
      When the Content-Security-Policy is built
      Then script-src includes https://cdn.langwatch.ai
      And style-src includes https://cdn.langwatch.ai
      And font-src includes https://cdn.langwatch.ai
      And connect-src includes https://cdn.langwatch.ai

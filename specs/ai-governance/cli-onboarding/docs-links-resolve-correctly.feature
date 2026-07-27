Feature: Docs links resolve to a reachable destination
  As a self-hosted user setting up the LangWatch CLI
  I want the "Install guide" and "CLI reference" links to open real docs
  So that I am not sent to a local development server that only exists on a
  contributor's own machine

  # `docsUrl()` links to a locally-running Mintlify instance on
  # http://localhost:3000 when the app itself is served from localhost, so a
  # contributor iterating on both the app and the docs in the same monorepo
  # checkout gets an in-sync round trip instead of punching out to
  # production. A packaged self-hosted server (npx @langwatch/server, a
  # Docker image, a Helm chart) is ALSO served from localhost or another
  # non-production hostname, but never has Mintlify running alongside it, so
  # the same hostname check sent every "Install guide" / "CLI reference" /
  # docs link on those installs to a dead http://localhost:3000.

  @unit
  Scenario: A contributor's local dev server links to the local docs server
    Given the app is served from "localhost"
    And the running build is a development build
    When a docs link is resolved
    Then it points at "http://localhost:3000"

  @unit
  Scenario: A packaged self-hosted server on localhost links to production docs
    Given the app is served from "localhost"
    And the running build is a production build
    When a docs link is resolved
    Then it points at "https://docs.langwatch.ai"

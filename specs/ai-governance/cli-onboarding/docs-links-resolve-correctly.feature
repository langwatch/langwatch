Feature: Docs links resolve to a reachable destination
  As a self-hosted user setting up the LangWatch CLI
  I want the "Install guide" and "CLI reference" links to open real docs
  So that I am not sent to a local development server that only exists on a
  contributor's own machine

  # Contributors iterating on the app and its docs in the same monorepo
  # checkout get an in-sync local round trip. Everyone else, most of all a
  # packaged self-hosted install (npx @langwatch/server, a Docker image, a
  # Helm chart), needs every onboarding documentation link to reach real,
  # working documentation instead.

  @unit
  Scenario: A contributor's local checkout links to their own local docs
    Given a contributor is running the app from their own local checkout
    When they open an onboarding documentation link
    Then it opens their local documentation

  @unit
  Scenario: A packaged self-hosted install links to real documentation
    Given the app is a packaged self-hosted install
    When a user opens an onboarding documentation link
    Then it opens the real, reachable documentation

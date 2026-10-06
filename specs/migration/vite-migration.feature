# The acceptance checklist of the finished Next.js to Vite move was deleted; only the config-loading scenario remains.

Feature: Next.js to Vite Migration
  As a LangWatch developer
  I want to migrate from Next.js to pure Vite with React Router
  So that the frontend builds faster and we eliminate unnecessary SSR overhead

  Background:
    Given the app is built with Vite instead of Next.js
    And the app uses React Router for client-side navigation
    And all API routes are served by standalone Hono server
    And the Hono server serves the Vite SPA for non-API routes

  # --- Build & Deployment ---

  @unit
  Scenario: The Vite config loads the way the dev and build scripts load it
    Given the config imports workspace packages whose relative imports carry no extension
    When Vite loads the config file with the loader the package scripts name
    Then the config resolves without a module resolution error


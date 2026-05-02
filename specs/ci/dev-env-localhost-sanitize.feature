Feature: Dev launchers strip stale localhost-pinned NEXTAUTH_URL / BASE_HOST
  As a contributor running a second worktree on the same machine
  I need `make quickstart` (and `make dev*`) to pick a dynamic port without 403ing on login
  So I don't have to manually re-export NEXTAUTH_URL every time port 5560 is busy.

  Background: tracking lw#3453. compose.dev.yml interpolates
  NEXTAUTH_URL/BASE_HOST with `${VAR:-http://localhost:${APP_PORT}}` — but
  any *exported* `http://localhost:5560` (from a prior session, zsh helper,
  etc.) wins over the dynamic-port fallback, and login then 403s because
  the cookie origin no longer matches the host port.

  The launchers source scripts/lib/sanitize-dev-env.sh, which rewrites
  stale localhost values to the current APP_PORT but leaves real proxy /
  tunnel overrides (https://*.boxd.sh, ngrok URLs, 127.0.0.1, etc.) alone.

  @unit
  Scenario: sanitize rewrites stale localhost NEXTAUTH_URL to current APP_PORT
    Given APP_PORT=5562 and the inherited NEXTAUTH_URL points at port 5560
    When sanitize_localhost_dev_env runs
    Then NEXTAUTH_URL is rewritten to http://localhost:5562

  @unit
  Scenario: sanitize rewrites stale localhost BASE_HOST to current APP_PORT
    Given APP_PORT=5562 and the inherited BASE_HOST points at port 5560
    When sanitize_localhost_dev_env runs
    Then BASE_HOST is rewritten to http://localhost:5562

  @unit
  Scenario: sanitize fills NEXTAUTH_URL from APP_PORT when unset
    Given APP_PORT=5562 and NEXTAUTH_URL is unset
    When sanitize_localhost_dev_env runs
    Then NEXTAUTH_URL is exported as http://localhost:5562

  @unit
  Scenario: sanitize leaves https boxd-proxy NEXTAUTH_URL untouched
    Given NEXTAUTH_URL=https://langwatch-fork.boxd.sh
    When sanitize_localhost_dev_env runs
    Then NEXTAUTH_URL is unchanged

  @unit
  Scenario: sanitize leaves a 127.0.0.1 NEXTAUTH_URL untouched
    Given NEXTAUTH_URL=http://127.0.0.1:5560
    When sanitize_localhost_dev_env runs
    Then NEXTAUTH_URL is unchanged

  @unit
  Scenario: sanitize leaves a non-localhost http override untouched
    Given NEXTAUTH_URL=http://abc123.ngrok.io
    When sanitize_localhost_dev_env runs
    Then NEXTAUTH_URL is unchanged

  @unit
  Scenario: sanitize warns and returns nonzero when APP_PORT is unset
    Given APP_PORT is unset
    When sanitize_localhost_dev_env runs
    Then it prints a warning that mentions APP_PORT
    And it exits with a nonzero status

  @unit
  Scenario: sanitize is a noop when stale URL already matches current port
    Given APP_PORT=5562 and NEXTAUTH_URL already=http://localhost:5562
    When sanitize_localhost_dev_env runs
    Then it does not log a "rewriting stale" line
    And NEXTAUTH_URL is unchanged

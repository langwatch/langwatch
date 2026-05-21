Feature: Fresh-clone dev setup friction removal
  As a developer cloning LangWatch for the first time
  I want package overrides and gateway secret placeholders to not block first-run
  So that "fresh clone → green app" succeeds in one cycle instead of six

  # Scope: tracks frictions #1 and #2 from issue #3903.
  # Friction #3 (goose host prereq) is a sibling issue.
  # Friction #4 (DB ports) shipped via PR #3860.

  # --- Friction #1: ALREADY RESOLVED ON MAIN (2026-05-21) ---
  # Direct verification of langwatch/package.json on the issue3903 branch (at main HEAD)
  # found no top-level "overrides" key. Only "pnpm.overrides" remains, which is the
  # canonical pnpm v10 location and not dead code. No fix needed; AC #1 and AC #2 are
  # marked resolved in the issue body. Scenarios moved here as historical context.

  # --- Friction #2: empty gateway secrets fail Zod cryptically ---

  @unit
  Scenario: .env.example ships a sentinel placeholder for LW_GATEWAY_INTERNAL_SECRET
    Given the file "langwatch/.env.example"
    When the line declaring "LW_GATEWAY_INTERNAL_SECRET" is read
    Then the value is a non-empty sentinel string naming the generation command
    And the preceding comment block instructs the reader to run "openssl rand -hex 32"

  @unit
  Scenario: .env.example ships a sentinel placeholder for LW_GATEWAY_JWT_SECRET
    Given the file "langwatch/.env.example"
    When the line declaring "LW_GATEWAY_JWT_SECRET" is read
    Then the value is a non-empty sentinel string naming the generation command
    And the preceding comment block instructs the reader to run "openssl rand -hex 32"

  @unit
  Scenario: .env.example ships a sentinel placeholder for LW_VIRTUAL_KEY_PEPPER
    Given the file "langwatch/.env.example"
    When the line declaring "LW_VIRTUAL_KEY_PEPPER" is read
    Then the value is a non-empty sentinel string naming the generation command
    And the preceding comment block instructs the reader to run "openssl rand -hex 32"

  @integration
  Scenario: First-run env validation surfaces a self-documenting error for unset gateway secrets
    Given a fresh ".env" created from ".env.example" with no manual edits
    When the app boots and env-create.mjs validates the environment
    Then validation fails with a non-zero exit
    And the error names each of "LW_GATEWAY_INTERNAL_SECRET", "LW_GATEWAY_JWT_SECRET", and "LW_VIRTUAL_KEY_PEPPER"
    And the error output contains the minimum character requirement so the user knows to generate a real secret

  # --- Friction #5: no new postinstall network calls ---

  @unit
  Scenario: No postinstall script reaches the network to download goose
    Given the file "langwatch/package.json"
    When the "scripts.postinstall" and "scripts.prepare" fields are inspected
    Then no script downloads a binary from the network
    And goose installation is left to the host (out of scope here)

  # --- Friction #6: fresh-clone end-to-end against current Makefile ---

  @e2e @unimplemented
  # HARNESS_GAP: Requires a fresh clone (no node_modules, no .env) on a host
  # with Docker free of port collisions on :5432/:6379/:8123. This worktree
  # cannot self-test the "fresh clone" precondition. Run manually before
  # closing #3903:
  #   git clone git@github.com:langwatch/langwatch.git /tmp/lw-ac6 && cd /tmp/lw-ac6
  #   cp langwatch/.env.example langwatch/.env
  #   # generate three real secrets per the inline `openssl rand -hex 32` hints
  #   make quickstart all-local
  #   # expect: stack starts, no ERR_PNPM_LOCKFILE_CONFIG_MISMATCH,
  #   # no cryptic Zod min(32) error, app reachable on the documented URL.
  Scenario: Fresh clone reaches a green app via make quickstart all-local in one cycle
    Given a fresh clone of the repository at HEAD
    And the host has Docker, Node, and pnpm installed
    When I copy "langwatch/.env.example" to "langwatch/.env"
    And I generate values for the three gateway secrets per the inline instructions
    And I run "make quickstart all-local"
    Then the stack starts without ERR_PNPM_LOCKFILE_CONFIG_MISMATCH
    And the stack starts without a cryptic Zod error on gateway secrets
    And the LangWatch app serves successfully

  # --- AC Coverage Map ---
  # AC 1 (~~"Top-level overrides block deleted"~~) — already resolved on main, no scenario
  # AC 2 (~~"pnpm install --frozen-lockfile succeeds"~~) — already passes on main, covered by AC 6 e2e
  # AC 3 ("langwatch/.env.example declares sentinel placeholders for the three gateway secrets")
  #   -> Scenario: .env.example ships a sentinel placeholder for LW_GATEWAY_INTERNAL_SECRET
  #   -> Scenario: .env.example ships a sentinel placeholder for LW_GATEWAY_JWT_SECRET
  #   -> Scenario: .env.example ships a sentinel placeholder for LW_VIRTUAL_KEY_PEPPER
  # AC 4 ("cp .env.example .env && pnpm dev produces a Zod error that names the gateway secrets and the generation command")
  #   -> Scenario: First-run env validation surfaces a self-documenting error for unset gateway secrets
  # AC 5 ("No new postinstall network calls introduced")
  #   -> Scenario: No postinstall script reaches the network to download goose
  # AC 6 ("The Repro section in this body still passes end-to-end on a fresh clone using make quickstart all-local")
  #   -> Scenario: Fresh clone reaches a green app via make quickstart all-local in one cycle

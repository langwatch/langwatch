Feature: The runtime-dependencies policy
  The production image installs the server packages with `pnpm install --prod`
  (infra/docker/prune-runtime-tree.sh), so a package listed only under
  devDependencies is not in the image. A file the server loads that imports
  such a package passes every test, then crashes the pod on boot with
  ERR_MODULE_NOT_FOUND. Which files the server loads is a graph property: it
  follows value imports from the runtime roots, never type-only imports or tests.

  Rule: `runtime-dependencies` fails a file the server loads that imports a
    package its own package.json declares only under devDependencies

  Background:
    Given a workspace whose runtime image installs the "@langwatch/worker" package
    And "@langwatch/worker" depends on a feature process package

  @unit
  Scenario: A dev-only package the server loads is reported
    Given the process package's service value-imports "@langwatch/handled-error"
    And the process package lists "@langwatch/handled-error" only in devDependencies
    When the runtime-dependencies policy runs over the workspace
    Then it reports the service file and its import of "@langwatch/handled-error"
    And the fix says to move "@langwatch/handled-error" to dependencies in "@langwatch/dataset-process"

  @unit
  Scenario: A dev-only package the start script preloads is reported
    Given the worker's start script runs `node --import @langwatch/preload/register`
    And the preload file value-imports a package "@langwatch/preload" lists only in devDependencies
    When the runtime-dependencies policy runs over the workspace
    Then it reports the preload file

  @unit
  Scenario: A peer the image install strips is not installed at runtime
    Given the image pnpmfile deletes the "typescript" peer
    And the process package lists "typescript" only in peerDependencies
    And the process package's service value-imports "typescript"
    When the runtime-dependencies policy runs over the workspace
    Then it reports the service file and its import of "typescript"

  @unit
  Scenario: A peer the image install keeps passes
    Given the image pnpmfile deletes the "typescript" peer only
    And the process package lists "zod" in peerDependencies
    And the process package's service value-imports "zod"
    When the runtime-dependencies policy runs over the workspace
    Then it reports nothing

  @unit
  Scenario: An optional peer the image install keeps passes
    Given the process package lists "zod" in peerDependencies, marked optional
    And the process package's service value-imports "zod"
    When the runtime-dependencies policy runs over the workspace
    Then it reports nothing

  @unit
  Scenario: A recipe written as --filter-prod=<package> is read
    Given the runtime recipe installs `--filter-prod=@langwatch/worker` with no closure dots
    And the process package's service value-imports a package it lists only in devDependencies
    When the runtime-dependencies policy runs over the workspace
    Then it reports the service file

  @unit
  Scenario: A recipe that names no workspace package fails loudly
    Given the runtime recipe's `--filter-prod` names a package the workspace does not have
    When the runtime-dependencies policy runs over the workspace
    Then it reports the recipe file, naming the missing package

  @unit
  Scenario: A missing recipe fails loudly while the image is still built
    Given the workspace has infra/docker/Dockerfile
    And it has no infra/docker/prune-runtime-tree.sh
    When the runtime-dependencies policy runs over the workspace
    Then it reports the Dockerfile, saying the recipe is gone

  @unit
  Scenario: A workspace that builds no image is not judged
    Given the workspace has neither infra/docker/Dockerfile nor the runtime recipe
    When the runtime-dependencies policy runs over the workspace
    Then it reports nothing

  @unit
  Scenario: A dev-only package only a type import names passes
    Given the process package's service imports "@langwatch/handled-error" with `import type`
    And the process package lists "@langwatch/handled-error" only in devDependencies
    When the runtime-dependencies policy runs over the workspace
    Then it reports nothing

  @unit
  Scenario: A dev-only package only a test imports passes
    Given only a test file of the process package imports "@langwatch/handled-error"
    And the process package lists "@langwatch/handled-error" only in devDependencies
    When the runtime-dependencies policy runs over the workspace
    Then it reports nothing

  @unit
  Scenario: A package the server never loads is not judged
    Given a package the runtime roots do not reach imports a dev-only package from its source
    When the runtime-dependencies policy runs over the workspace
    Then it reports nothing

  @unit
  Scenario: A runtime dependency the server loads passes
    Given the process package lists "@langwatch/handled-error" in dependencies
    And the process package's service value-imports it
    When the runtime-dependencies policy runs over the workspace
    Then it reports nothing

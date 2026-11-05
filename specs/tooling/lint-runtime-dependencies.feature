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
    Then it reports the service file with the fix "move it to dependencies"

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

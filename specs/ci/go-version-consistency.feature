Feature: One Go version, stated once
  As a developer reading a Go build failure
  I want every part of CI to compile with the toolchain the module asks for
  So that a passing job and a shipped image mean the same thing

  # The Go version lived in eight places — go.work, three go.mod files and four
  # Dockerfile base images — plus three workflows that restated it as a literal
  # string. They had already drifted:
  #
  #   go.work                              1.26.5
  #   go.mod                               1.26.5
  #   infra/clickhouse-serverless/go.mod   1.26.1
  #   infra/clickhouse-serverless/Docker*  golang:1.26-alpine   <- floating
  #   sdks/go/go.mod                       1.25.0 (deliberate)
  #   sdk-go-ci.yml, sdk-go-cd.yml         "1.25"
  #   clickhouse-serverless.yml            "1.26"
  #
  # Nothing failed. Different jobs simply compiled the same code with different
  # toolchains, and the published image was built with a third.
  #
  # Workflows are fixed by reading go-version-file rather than a literal, so
  # there is no second copy left to drift. Dockerfiles cannot read a go.mod,
  # which is what this guard is for.

  Background:
    Given the root go.mod declares the repository's Go version

  @unit
  Scenario: Every non-exempt Go toolchain reference in the repo agrees
    Given the guard runs against the repository
    Then it reports no disagreement

  @unit
  Scenario: A child module on a different version fails the check
    Given a non-root go.mod declaring a different version
    Then the guard names the module and both versions
    # The guard first read only the root module, which meant
    # infra/clickhouse-serverless could drift straight back and the exemption
    # list below was never consulted at runtime at all.

  @unit
  Scenario: A workflow that sets up Go without naming a module fails the check
    Given a setup-go step with neither go-version nor go-version-file
    Then the guard reports that it uses the action's default toolchain
    # Neither key is a third source of truth, and a silent one: the version
    # becomes whatever the action currently ships.

  @unit
  Scenario: A lowercase or indented FROM is still checked
    Given a Dockerfile written as "from golang:..." or with a leading indent
    Then the guard still compares its version
    # Dockerfile instructions are case-insensitive, so an uppercase-only,
    # column-zero pattern let a valid spelling drift unchecked.

  @unit
  Scenario: The workspace and the root module must agree
    Given go.work declares a different version from go.mod
    Then the guard reports the disagreement

  @unit
  Scenario: A Dockerfile built with a different Go than the module fails the check
    Given a Dockerfile whose golang base image is a different patch release
    Then the guard names the file and both versions

  @unit
  Scenario: A floating Go base image fails the check
    Given a Dockerfile whose golang base image omits the patch, like "golang:1.26-alpine"
    Then the guard rejects it as floating
    # A floating tag resolves to whatever patch was newest that day, so the
    # image quietly stops matching the module without any file changing.

  @unit
  Scenario: A workflow pinning Go with a literal fails the check
    Given a workflow step that sets up Go with a version literal
    Then the guard tells it to use go-version-file instead

  @unit
  Scenario: The published SDK keeps its own floor
    Given sdks/go is a published module
    Then it is exempt from matching the root version
    And the exemption records why
    # Its go directive is the floor consumers must meet; raising it drops
    # support for anyone below. sdk-go-ci and sdk-go-cd build it standalone
    # with GOWORK=off precisely so that stays true.

  @unit
  Scenario: A module inside the SDK tracks the SDK's floor, not the repo's
    Given a module under sdks/go declaring the same version as sdks/go/go.mod
    Then the guard reports no disagreement
    # The exemption is from the ROOT version, not from agreement. #4998 added
    # nine modules under sdks/go — a client and eight provider
    # instrumentations — all at the SDK's floor. Listing each one would mean
    # every new provider package breaks the guard the day it lands.

  @unit
  Scenario: A module inside the SDK that drifts above the floor fails the check
    Given a module under sdks/go declaring a higher version than sdks/go/go.mod
    Then the guard names the module, the family's go.mod and both versions
    # This is the failure that actually reaches a customer: someone who meets
    # the SDK's declared directive cannot build a sibling instrumentation
    # module that quietly asks for more. Waving the whole subtree through
    # would have left it unchecked.

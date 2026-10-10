# Implementation:
#   packages/browser/src/ui-feature.ts
#   apps/ui/src/browser-modules.generated.ts
# Plan:
#   dev/docs/plans/ui-install-surface-2026-09-05.md

Feature: One install surface per feature
  Each feature directory exports exactly one `<x>Feature = uiFeature({...})`
  value instead of up to three hand-spread exports, and `installUiFeatures`
  composes the whole list into one install rather than two twin registries a
  screen or a drawer could be left out of by hand.

  Background:
    Given the module directories that ship a browser half

  @unit
  Scenario: A new module cannot be half-registered
    Given every module directory that ships a browser half
    When the installed browser module list is composed
    Then every such module appears in the installed list

  @unit
  Scenario: Two features serving the same page key are refused by name
    Given two features whose loaders both answer the same page key
    When they are composed with installUiFeatures
    Then composition throws, naming both features and the shared page key

  @unit
  Scenario: Two features serving the same drawer name are refused by name
    Given two features whose drawers both answer the same drawer name
    When they are composed with installUiFeatures
    Then composition throws, naming both features and the shared drawer name

  @unit
  Scenario: A feature without an api still serves its pages
    Given a feature built with no api binding
    When it is composed with installUiFeatures
    Then it contributes no Provider and its own page loaders still resolve

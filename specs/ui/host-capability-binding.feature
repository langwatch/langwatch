# Implementation:
#   apps/ui/src/features/*/ui/sections/*-host.tsx
#   apps/ui/src/behavior/ui-capabilities.ts

Feature: Host adapters call capability methods on their capability
  The route, feedback, navigation and session capabilities are class
  instances whose methods read `this`. A host that hands one of those
  methods on as a bare property (`setQuery: route.setQuery`) passes it
  unbound, and the first call throws "Cannot read properties of undefined"
  in the middle of a click. Add Model Provider opened no drawer for exactly
  this reason. Every hand-off wraps the call so the method keeps its
  receiver.

  @unit
  Scenario: No host hands a capability method on unbound
    Given every host adapter under the browser application's features
    When their capability hand-offs are read
    Then none passes a route, feedback, navigation, session or clipboard method as a bare property

Feature: Group queue refactor safety nets
  As a maintainer relaying out the group-queue package
  I want its Lua sources and public surface pinned by snapshots
  So that a behaviour-neutral move is proven neutral, and any real change is deliberate

  @unit @refactor-safety
  Scenario: Every Lua source keeps its fingerprint
    Given every CachedLuaScript the package builds and every exported Lua constant
    When each source is hashed with sha1
    Then the sorted name to sha1 map equals the committed snapshot

  @unit @refactor-safety
  Scenario: A Lua script added without being named fails the guard
    Given the explicit list of CachedLuaScript construction sites and exported Lua constants
    When a source file builds a CachedLuaScript or exports a Lua constant the list does not name
    Then the guard test fails and names the missing script

  @unit @refactor-safety
  Scenario: Every package entry keeps its runtime surface
    Given each entry in the package exports map
    When its export keys, their typeof and the prototype methods of its classes are listed
    Then the sorted listing equals the committed snapshot

Feature: The framework feature layout (ADR-181)
  A framework package that opts in with "langwatch": { "layout": "features" } in
  its own package.json nests like a process half: concern folders of services,
  repositories, channels, rules, eventing and vocabulary, shared vocabulary,
  rules, repositories, channels and telemetry at the top, public runtime classes
  in app/. The grammar is packages/oxlint-rules/grammar/feature-layout-policy.mjs
  and grammar/module-layers.mjs; the layered rules read it only for a package
  that opted in, so a framework that has not keeps every verdict it had.

  Background:
    Given the langwatch oxlint plugin and a workspace with one opted-in framework package

  Rule: The grammar is closed and opt-in

    @unit
    Scenario: An opted-in framework package has its own closed list of homes
      Given framework source paths at the top, under a concern and in closed folders
      When the framework grammar reads them
      Then entries, app, vocabulary, rules, telemetry, tasks, tier folders and concern folders have a home
      And utils, domain, adapters, ports, stores, server and a second concern level have none
      And the message the layout rule prints names the same allowlist

    @unit
    Scenario: A framework package has no top-level service or pipeline and no registry or bundle file
      Given a top-level services or eventing file, or a repository or channel registry or bundle
      When the framework grammar reads it
      Then it has no home
      And the allowlist says no registry or bundle file

    @unit
    Scenario: A module's process grammar gains no framework home
      Given a framework-only home such as vocabulary, telemetry or a Lua script file
      When the process grammar reads it
      Then it has no home there

    @unit
    Scenario: A package opts in only through its own manifest's layout key
      Given package manifests with and without layout features under the langwatch key
      When the grammar reads them
      Then only layout features under langwatch opts in
      And the entry files are the src targets the exports name

    @unit
    Scenario: A framework's vocabulary and telemetry are leaf layers
      Given a framework vocabulary and a telemetry module importing other layers
      When the layer tables read the imports
      Then vocabulary takes vocabulary, rules and telemetry, and a type from anywhere
      And telemetry takes only telemetry

  Rule: The layered rules read an opted-in framework package

    @unit
    Scenario: A framework file outside its homes is reported with the framework allowlist
      Given an opted-in framework file with no home in the framework grammar
      When the feature-source-layout rule runs over it
      Then it reports frameworkPath with the path and the framework allowlist
      And an entry, an app, a vocabulary, telemetry, a concern's service, Lua script and channel pass

    @unit
    Scenario: A framework layer that crosses its row is reported
      Given an opted-in framework vocabulary, telemetry module or service crossing its row
      When the module-layers rule runs over it
      Then it reports vocabularyCrossing, telemetryCrossing or serviceNamesABackend on the import's line
      And a vocabulary's import of rules, telemetry or a type passes

    @unit
    Scenario: A framework class with only static members is reported
      Given an opted-in framework service whose class has only static members
      When the namespace-class rule runs over it
      Then it reports namespaceClass

    @unit
    Scenario: A framework class takes the module's shape unless an entry publishes it
      Given an opted-in framework's service, tier repository and app classes
      When the module-classes rule runs over them
      Then a service with a public constructor reports publicConstructor
      And a tier repository with no create reports create
      And a class an entry publishes, by name or through export *, keeps its name and its constructor

    @unit
    Scenario: A framework store client sits only in its tier folders and app
      Given an opted-in framework file naming the Redis client or Prisma
      When the store-containment rule runs over it
      Then a concern's service reports storeClientValue and the vocabulary reports storeNamed
      And a repository tier folder, a channel tier folder and app pass

    @unit
    Scenario: A framework service may not open a channel
      Given an opted-in framework concern's service calling fetch
      When the service-does-not-open-a-channel rule runs over it
      Then it reports serviceOpensAChannel
      And the same call in a channel tier passes

    @unit
    Scenario: A framework package that has not opted in is left alone by the layered rules
      Given a framework package whose manifest carries no layout key
      When each layered rule runs over a file that would be reported in an opted-in package
      Then none of them reports anything

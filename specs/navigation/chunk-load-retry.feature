# The application is split into chunks the browser fetches as a page needs them. On a link
# that drops requests, one lost chunk must not take the whole application away.
#
# Browsers that follow the HTML spec before whatwg/html#10327 (merged July 2026) remember a
# failed module fetch for the life of the page, so importing the same address again rejects
# at once. A retry therefore asks for the address the failure named under a fresh query.
# That returns the module itself, so the build wraps each bare `import()` in our code
# (importChunk); a loader around it (loadChunk) retries by calling itself again.
#
# Implementation: packages/browser-host/src/navigation.ts (importChunk, loadChunk, lazyChunk,
# lazyRoute, registerChunkReloadListener), packages/browser-host/src/chunk-refetch.ts,
# apps/ui/vite/chunk-import-retry.ts

Feature: A chunk that does not arrive is retried, then explained

  Rule: A dropped request is retried before anything fails

    @unit
    Scenario: A dropped chunk request is retried with backoff
      Given a chunk whose request is dropped twice
      When the application loads it
      Then it waits about half a second, then a second, and loads it

    @unit
    Scenario: A retry asks for the chunk under a fresh address
      Given a browser that remembers a failed fetch of an address
      When a chunk is retried
      Then it is asked for under the address the failure named, with a new query each time

    @unit
    Scenario: A loader that reshapes its module keeps its shape on a retry
      Given a loader that returns "{ default: module.Thing }"
      When its chunk is dropped once
      Then the retry calls the loader again, never the bare address
      And a failure the import inside it already retried is not retried again

    @unit
    Scenario: The build retries every import in our code where it is made
      Given a module of ours with an "import()" expression
      When the application is built
      Then the expression is wrapped in importChunk
      And dependencies and the retry helper itself are left alone

    @unit
    Scenario: A chunk that never arrives fails after three retries
      Given a chunk whose every request is dropped
      When the application loads it
      Then it tries four times in all, waiting about 0.5, 1 and 2 seconds
      And the load fails with the last failure

    @e2e
    Scenario: The application still opens when its first requests for a chunk are dropped
      Given the first two requests for the chunk of a root host are dropped
      When a person opens a dashboard
      Then the dashboard opens

  Rule: What still fails says so, and never reloads into the browser's error page

    @unit
    Scenario: Vite's preload error never turns a failure into an empty module
      Given Vite reports a chunk that did not load
      Then the import still rejects with the failure
      And no loader reads a module that is not there

    @unit
    Scenario: A dropped connection never reloads the page
      Given a chunk that never arrived
      And the server does not answer
      Then the page is not reloaded

    @unit
    Scenario: A chunk a deploy removed reloads the page once
      Given a chunk that never arrived
      And the server answers that the chunk is not there
      Then the page reloads once

    @integration
    Scenario: A failure that outlives its retries offers a retry
      Given a chunk the application needs at its root never arrived
      Then the page says "Could not load" and "Check your connection, then try again."
      And "Try again" reloads the page

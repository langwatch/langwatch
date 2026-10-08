# The first load fetches the application's code as a set of files, all needed before
# anything paints. On a link that drops requests, one lost file left a blank page.
#
# Chromium keeps every file that did arrive in its HTTP cache, even when the module graph
# around it failed (assets are served `immutable`), so a reload fetches only what is missing
# and converges.
#
# Implementation: the `ui-boot-recovery` script in apps/ui/index.html; UI_BOOT_EVENTS in
# packages/browser-host/src/navigation.ts; apps/ui/vite/entry-core-chunks.ts

Feature: The application recovers from files a lossy link dropped while it boots

  Rule: A file lost before the first page shows reloads the page, a capped number of times

    @unit
    Scenario: A dropped entry file reloads the page
      Given the page has not shown yet
      When a script or stylesheet the server's page names fails to load
      Then the page reloads
      And it says "Slow connection, retrying (1 of 6)..." while it waits

    @unit
    Scenario: A chunk that outlived its retries before the first page reloads the page
      Given the page has not shown yet
      When a chunk fails after its retries
      Then the page reloads instead of the application showing its own failure

    @unit
    Scenario: A request that hangs counts as dropped
      Given the page has not shown yet
      When nothing finishes loading for 30 seconds
      Then the page reloads

    @unit
    Scenario: A reload that fetched new code is progress
      Given a reload that fetched files the cache did not have
      When the next load still fails
      Then the count of tries without progress starts again

    @unit
    Scenario: Six reloads in a row that fetch nothing new give up
      Given six reloads in a row fetched no new code
      When the next load fails
      Then the page says "Could not load. Check your connection." with a "Try again" button
      And it does not reload by itself

    @unit
    Scenario: Without storage for the counter the page asks instead of reloading
      Given the browser refuses session storage
      When a file fails before the first page shows
      Then the page offers "Try again" instead of reloading

    @unit
    Scenario: A file a screen adds later does not reload the page
      Given the page has not shown yet
      When a stylesheet the application added itself fails to load
      Then the page does not reload

  Rule: Once the first page shows, the recovery stands down

    @unit
    Scenario: The first page clears the counter
      Given the page reloaded twice to boot
      When the first page shows
      Then the counter is cleared and the status line is gone
      And a later failure does not reload the page

  Rule: The first load is a handful of files

    @unit
    Scenario: The entry's static imports share one core file
      Given the modules the entry imports statically
      When the build splits the code
      Then they land in the core file, never a lazy screen's module

    @unit
    Scenario: The host mounts share one file
      Given a module host mount, named "<name>-host-mount.tsx"
      When the build splits the code
      Then it lands in the host-mounts file

    @e2e
    Scenario: Sign-in shows on a link that drops a fifth of its requests
      Given a link with 250 ms of latency that drops 20% of asset requests
      When a person opens the sign-in page, signs in and opens a dashboard
      Then each page shows

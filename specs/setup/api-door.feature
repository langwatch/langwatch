Feature: The one door an api process serves the product through
  As an operator running the LangWatch api
  I want every declared transport and the browser application on one listener
  So that a pod answering "/api/*" is the same pod a browser asks for "/"

  # WHY THIS EXISTS
  #
  # `boot()` mounts every module's declared REST family and tRPC namespace on
  # the doors the process opened, and hands back the application. Nothing
  # served it: `/api/*` answered 404 while `/healthz` answered 200. The server
  # now takes the booted application — `server.serve(app, { ui })` — walks the
  # transports it mounted, hosts them on the SAME listener the health door is
  # on, and puts the built browser application behind them, answering last so
  # it can shadow no declared address.
  #
  # Order on the door is the contract: "/healthz" and the metrics scrape are
  # built in and answer first, the product's transports next, the browser
  # application last. Everything under "/api" belongs to the transports
  # whether or not this build mounted that address, so an SDK calling an
  # endpoint that is not served hears 404 rather than a page with a 200 on it.

  Rule: The door answers in order, and the browser application answers last

    @unit
    Scenario: A declining contribution falls through to the next
      Given two contributions on the door, each answering a different address
      When a request arrives for the address only the later one answers
      Then the later one answers it

    @unit
    Scenario: The lower order answers first
      Given two contributions on the door that would both answer an address
      When a request arrives for it
      Then the lower order answers and the other is never asked

    @unit
    Scenario: Nothing on the door claims the request
      Given a contribution that declines the request
      When it arrives
      Then the door answers 404

    @unit
    Scenario: A door handler fails
      Given a contribution that throws
      When it is asked
      Then the door answers 500 and reports the handler by name
      # A failing handler must never leave the socket open, and the log names
      # which contribution failed rather than "something on the door".

    @unit
    Scenario: The browser application answers an unclaimed address
      Given this deployment carries a browser build
      When a page is requested at an address no transport claimed
      Then the shell is served so the single page application routes it

    @unit
    Scenario: A built asset is missing
      Given this deployment carries a browser build
      When a content-hashed asset that is gone is requested
      Then the door answers 404
      # Never the shell: a script tag handed an HTML body breaks the page with
      # a parse error instead of the 404 the loader knows how to recover from.

    @unit
    Scenario: A built asset is served
      Given this deployment carries a browser build
      When a content-hashed asset is requested
      Then it is served with an immutable cache

    @unit
    Scenario: A write is never answered by the browser application
      Given this deployment carries a browser build
      When a write arrives at an address no transport claimed
      Then the browser application declines it

    @unit
    Scenario: The deployment carries no browser build
      Given this deployment carries no browser build
      When a page is requested
      Then the door answers 404
      # Locally Vite owns the browser and this process answers "/api/*" alone.

  Rule: The served page carries what the browser needs to start

    @unit
    Scenario: The served page carries this deployment's configuration
      Given this deployment projects a public configuration
      When the shell is served
      Then it is injected at the start of the head, before the bundle's scripts

    @unit
    Scenario: The served page carries this deployment's security headers
      Given this deployment states its own security headers
      When the shell is served
      Then they are sent with the document the browser reads them off

  Rule: One process opens one door

    @unit
    Scenario: One door carries every mounted transport
      Given an application whose REST families and tRPC namespaces all mounted
        on one door
      When the server serves it
      Then that door is hosted once, however many transports named it

    @unit
    Scenario: A mounted transport is not a door handler
      Given an application carrying a mounted transport the server cannot serve
      When the server is asked to serve it
      Then it refuses, naming the application

  Rule: A draining process takes no new work

    @unit
    Scenario: The door refuses new work while draining
      Given a serving process that has begun shutting down
      When a request arrives for a mounted transport
      Then it is refused with 503 while "/healthz" still answers
      # The health door stops last, so a probe during shutdown still sees the
      # process as alive while the product surface refuses by name.

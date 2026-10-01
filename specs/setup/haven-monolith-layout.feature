# haven boots the layout the checkout actually has. This branch's layout is
# modular - apps/ui and apps/api, two Node lanes - and origin/main is still the
# monolith - platform/app, one Node process serving the browser application and
# its API together. apidiff and visualdiff boot a base ref as its own haven
# stack (tools/havenrun, specs/tooling/visualdiff-on-haven.feature), and that
# base ref is main, so haven has to be able to start a checkout that has neither
# @langwatch/ui nor @langwatch/dev-runtime in it.
#
# Nothing about the modular stack changes here. The layout is detected once, at
# up, recorded on the stack, and everything downstream reads that one answer.

Feature: Booting a monolith checkout through haven
  As a tool that boots a base ref as its own stack
  I want haven to start whatever the checkout defines
  So that a run can compare main against this branch without a second launcher

  Rule: The layout is detected once, at up, and recorded on the stack

    @unit
    Scenario: A checkout with the two application packages is modular
      Given a checkout that has apps/ui and apps/api
      When haven detects the layout
      Then the layout is modular

    @unit
    Scenario: A checkout with the monolith package is a monolith
      Given a checkout that has platform/app and neither application package
      When haven detects the layout
      Then the layout is monolith

    @unit
    Scenario: A checkout with neither shape is treated as modular
      Given a checkout with no recognisable application package
      When haven detects the layout
      Then the layout is modular, because the stack this haven belongs to is the modular one

    @unit
    Scenario: Status reports the layout and the single app lane
      Given a monolith stack on record
      When haven status is read as JSON
      Then the stack carries its layout
      And its lanes are one lane named app, on the port the app hostname routes to

  Rule: A monolith checkout runs one Node lane, named app

    @unit
    Scenario: The monolith plan is one Node lane
      Given a monolith stack
      When haven plans its children
      Then there is exactly one Node lane and it is named app
      And it runs the monolith package's own dev:app script from the workspace root
      And no ui lane and no backend lane are planned, because neither package exists in this checkout

    @unit
    Scenario: The app lane is handed the ports haven allocated
      Given a monolith stack whose app hostname and API port are allocated
      When the app lane is planned
      Then it is given PORT as the app port, so every port the checkout derives from it lands where haven routed it
      And it is given the API port haven allocated, so the API does not bind a port haven never reserved

    @unit
    Scenario: The app lane leaves the Go services to haven
      Given a monolith stack that also runs the Go services
      When the app lane is planned
      Then it is told to start neither the gateway nor the NLP engine itself
      And haven starts each Go service on the port it allocated for that service's hostname

    @unit
    Scenario: The app lane writes its own log capture
      Given a monolith stack
      When the app lane is planned
      Then its output is captured to the app log of that stack, so haven logs app reads it

  Rule: Readiness is the health path the checkout serves

    @unit
    Scenario: The app lane does not wait on itself
      Given a monolith stack whose one lane serves both the browser application and the API
      When the app lane is planned
      Then it starts immediately, because there is no other lane left to wait for

    @unit
    Scenario: The Go services wait for the health path
      Given a monolith stack that also runs the Go services
      When the Go services are planned
      Then each waits until the health path answers on the API port haven allocated
      And a gateway therefore never starts into a control plane that is not serving yet

  Rule: Lane names that do not exist here are refused by name

    @unit
    Scenario: The ui lane cannot be selected on a monolith stack
      Given a monolith checkout
      When a developer asks for the ui lane
      Then it is refused by name, saying the checkout runs one app lane
      And the refusal names the lane that does exist, rather than reading as a typo

    @unit
    Scenario: The backend lane cannot be selected on a monolith stack
      Given a monolith checkout
      When a developer asks for the backend lane
      Then it is refused by name, saying the checkout runs one app lane

  Rule: The one-shot jobs run under the checkout's own script names

    @unit
    Scenario: Migrations run under the monolith's own script
      Given a monolith checkout
      When haven runs the migration job before any service boots
      Then it runs the monolith package's own database preparation script
      And not the workspace root's script, which that checkout does not define

    @unit
    Scenario: Codegen is left to the app lane, which runs it itself
      Given a monolith checkout
      When haven runs the one-shot jobs
      Then it plans no separate codegen job
      And it says so in one line, because the app lane runs the same codegen on its way up

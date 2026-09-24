Feature: Sockets are declared like routes and mounted by the process
  As an operator running the api process
  I want every module's socket served from one upgrade listener
  So that the connected agents and the local folder reach the paths main served

  # ARCHITECTURE.md §8: a module declares its WebSocketProtocol; the process
  # opens one upgrade router and mounts every installed module's protocols, as
  # it mounts REST. Main's shape: platform/app/src/server/websockets/upgrade-router.ts.

  Rule: The api process opens one upgrade router

    @unit
    Scenario: An upgrade to a mounted protocol's path reaches that protocol
      Given protocols are mounted at the agent path and the local folder path
      When a client upgrades to each path
      Then each upgrade reaches its own protocol with its own application and headers

    @unit
    Scenario: An upgrade to a path no protocol mounted is answered 404
      When a client upgrades to a path no protocol declared
      Then the upgrade is answered 404 and the socket is closed

    @unit
    Scenario: Two protocols on one path are refused
      Given a protocol is mounted at a path
      When a second protocol is mounted at the same path
      Then the mount is refused naming the path

    @unit
    Scenario: An upgrade with no upgrade router is answered 404
      Given a server that was given no upgrade router
      When a client upgrades
      Then the upgrade is answered 404

    @unit
    Scenario: The upgrade router receives every upgrade and closes before the door
      Given a server with an upgrade router
      When a client upgrades and the server then shuts down
      Then the router received the upgrade
      And the router was closed

    @unit
    Scenario: A second upgrade router is refused
      When a server is given a second upgrade router
      Then it refuses by name

    @unit
    Scenario: A draining server answers an upgrade 503
      Given a server that is shutting down with a drain still running
      When a client upgrades
      Then the upgrade is answered 503 and never reaches the router

  Rule: The kernel mounts a declared socket only where the api opened a router

    @unit
    Scenario: A declared socket mounts on the api process's upgrade router
      Given a module declares a socket among its transports
      When the api process boots with an upgrade router
      Then the socket is mounted on it, bound to the module's own application

    @unit
    Scenario: An api process without an upgrade router refuses a declared socket by name
      When the api process boots with REST doors but no upgrade router
      Then boot is refused naming the module and the WebSocket protocol

    @unit
    Scenario: The worker never mounts a declared socket
      When the worker boots the same module
      Then no door is opened and boot succeeds

  Rule: The two sockets main served are declared by their modules

    @unit
    Scenario: The agent module declares its socket where main served it
      Then the agent module's transports include a socket at "/api/v1/agents/connect"

    @unit
    Scenario: An upgrade to the agent socket reaches the agent module with its headers
      When an SDK upgrades with authorization, x-project-id and x-agent-instance-token
      Then the agent application accepts the connection with those three values

    @unit
    Scenario: The langy module declares the local folder's socket where main served it
      Then the langy module's transports include a socket at "/api/v1/langy/control/connect"

    @unit
    Scenario: An upgrade to the local folder's socket reaches langy with the session key
      When the command line upgrades with its session key and x-project-id
      Then the langy application accepts the connection with the key and the project

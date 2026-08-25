# Coding Agent

Coding Agent owns session-level coding-agent observability: the durable session
aggregate, trace mapping, metric overlay, session-event sequence, sessions
screen, and pull-request usage/detail reads. One service owns those reads; it
uses GitHub and Project as full collaborating services, while its private
repositories own Coding Agent persistence. The bundled-plan decision remains a
named composition policy until Entitlement publishes that capability.

The contract contains portable Zod 4 values only. The server service owns its
private read repositories and is composed once by the application; it imports
neither application transports nor environment configuration.

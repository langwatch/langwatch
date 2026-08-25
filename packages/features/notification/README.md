# Notification

Notification owns durable user-visible notification records. It deliberately
does not own mail, Slack, HubSpot, queue, or HTTP providers. Those capabilities
are injected by the application or by the feature that decides when a
notification should be delivered.

The contract exposes the record vocabulary and one `NotificationService`.
The server package owns the private repository, Prisma adapter, and concrete
service. There is no web surface yet: the current application has no
notification inbox or preference UI.

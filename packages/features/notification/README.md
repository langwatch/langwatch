# Notification

Notification owns durable user-visible notification records. It deliberately
does not own mail, Slack, HubSpot, queue, or HTTP providers. Those capabilities
are injected by the application or by the feature that decides when a
notification should be delivered.

The contract exposes the record vocabulary and one `NotificationApi`.
The server package owns the private repository interface, its Prisma and memory
backends, and the concrete service; `notificationServer` selects a backend at
boot. The one web surface is the email-suppressions screen; there is no
notification inbox or preference UI yet.

// ruleid: pii-in-logger-call
logger.info("login", { email: user.email, id: 1 });
// ruleid: pii-in-logger-call
console.error("oops", { token: t });
// ruleid: pii-in-logger-call
logger.debug({ ...currentUser });
// ruleid: pii-in-logger-call
logger.info({ user });
// ok: pii-in-logger-call
logger.info("clean", { id: 1, role: "admin" });
// ok: pii-in-logger-call
logger.warn("just a message");
// Identifiers are logged raw on purpose and must stay unflagged. These cases
// are here so re-adding a userId/organizationId/projectId pattern to the rule
// fails the test rather than quietly reinstating the false positive.
// ok: pii-in-logger-call
logger.warn({ userId: u.id });
// ok: pii-in-logger-call
logger.info("scoped", { organizationId: org.id, projectId: project.id });

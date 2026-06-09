// ruleid: pii-in-logger-call
logger.info("login", { email: user.email, id: 1 });
// ruleid: pii-in-logger-call
logger.warn({ userId: u.id });
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

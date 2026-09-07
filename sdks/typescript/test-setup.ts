/**
 * Test-suite defaults.
 *
 * The CLI daemon is transparent in production: it is auto-spawned once an
 * identity has proved it calls the CLI repeatedly, and it serves subsequent
 * commands from a warm process. That is exactly the wrong thing to have running
 * underneath a test suite:
 *
 *  - A test that spawns the CLI several times would silently start being served
 *    by a daemon halfway through, so it would no longer be testing the code path
 *    it thinks it is.
 *  - A daemon spawned by a test outlives the test run (up to its idle timeout),
 *    holding the credentials the test used.
 *  - Worst of all, a daemon spawned by a PREVIOUS test run holds the PREVIOUS
 *    build's module graph. (The handshake's build check now evicts it, but the
 *    right answer is not to create it.)
 *
 * So: tests run in-process unless they explicitly opt in. The daemon's own
 * tests set `LANGWATCH_NO_DAEMON=0` per invocation, which this default respects.
 */
process.env.LANGWATCH_NO_DAEMON ??= "1";

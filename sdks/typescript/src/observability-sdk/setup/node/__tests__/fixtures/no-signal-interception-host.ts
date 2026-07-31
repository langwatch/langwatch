// Fixture run as a real child process by signal-shutdown.unit.test.ts. Proves
// the SDK never listens for SIGINT/SIGTERM: with only the SDK's default auto
// shutdown loaded (no host-level signal handler at all), the process must
// still die via the signal's own default disposition — no hang, no
// SDK-fabricated exit code.
import { setupObservability } from "../../index";

setupObservability({
  langwatch: "disabled",
  debug: { consoleTracing: true, logLevel: "error" },
});

process.stdout.write("READY\n");

setInterval(() => {
  // keep the loop alive; the process must only exit via the signal's own
  // default disposition, since nothing here listens for it
}, 1 << 30);

/**
 * Proves the corporate-proxy scenario: with only an HTTP proxy for egress, SES
 * traffic goes through the proxy instead of timing out.
 *
 * Starts its own logging CONNECT proxy, sends through the real SES provider,
 * and reports which hosts were tunnelled. The send itself fails (probe
 * credentials); the proxy log is the evidence, so a connection attempt is all
 * this needs to observe.
 *
 *   EMAIL_PROVIDER=ses USE_AWS_SES=true AWS_REGION=eu-central-1 \
 *     AWS_ACCESS_KEY_ID=probe AWS_SECRET_ACCESS_KEY=probe \
 *     pnpm tsx --env-file=.env scripts/qa-proxy-routing.ts
 *
 * Pass NO_PROXY=.amazonaws.com to confirm the bypass path logs nothing.
 */
import { createServer } from "node:net";
import { sendEmail } from "../src/server/mailer/emailSender";
import { EmailProviderConfigurationError } from "../src/server/mailer/providers/types";

const PROXY_PORT = 8888;

/** Minimal CONNECT proxy that records tunnelled hosts and refuses the tunnel. */
const startLoggingProxy = async (tunnelled: string[]) => {
  const server = createServer((socket) => {
    socket.once("data", (chunk) => {
      const requestLine = chunk.toString("utf8").split("\r\n")[0] ?? "";
      const match = /^CONNECT\s+(\S+)/i.exec(requestLine);
      if (match?.[1]) tunnelled.push(match[1]);
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    socket.on("error", () => void 0);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PROXY_PORT, "127.0.0.1", resolve);
  });
  return server;
};

async function main() {
  const tunnelled: string[] = [];
  const server = await startLoggingProxy(tunnelled);
  process.env.HTTPS_PROXY = `http://127.0.0.1:${PROXY_PORT}`;

  console.log(`HTTPS_PROXY = ${process.env.HTTPS_PROXY}`);
  console.log(`NO_PROXY    = ${process.env.NO_PROXY ?? "(unset)"}`);
  console.log(`AWS_REGION  = ${process.env.AWS_REGION ?? "(unset)"}`);

  try {
    await sendEmail({
      to: "someone@example.com",
      subject: "proxy routing probe",
      html: "<p>probe</p>",
    });
    console.log("send succeeded (unexpected with probe credentials)");
  } catch (error) {
    // A configuration error means the send never left the process, so nothing
    // was routed anywhere and the proxy log would be empty for the wrong
    // reason. That is a broken probe, not a result.
    if (error instanceof EmailProviderConfigurationError) {
      server.close();
      throw error;
    }
    console.log(
      `send failed as expected: ${(error as Error).name}: ${(error as Error).message.slice(0, 120)}`,
    );
  }

  server.close();
  report(tunnelled);
}

/** Whether the observed routing matches what the proxy settings asked for. */
function report(tunnelled: string[]): never {
  const bypassing = Boolean(process.env.NO_PROXY);
  console.log(
    tunnelled.length > 0
      ? `tunnelled through the proxy: ${tunnelled.join(", ")}`
      : "nothing was tunnelled through the proxy",
  );

  const ok = bypassing ? tunnelled.length === 0 : tunnelled.length > 0;
  const verdict = ok
    ? bypassing
      ? "PASS: NO_PROXY kept the request off the proxy"
      : "PASS: SES egress went through the proxy"
    : "FAIL: routing did not match the configured proxy settings";
  console.log(verdict);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

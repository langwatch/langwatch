/**
 * Proves the customer's scenario: with only a corporate HTTP proxy for egress,
 * SES traffic now goes through the proxy instead of timing out.
 *
 * Sends through the real SES provider against a logging CONNECT proxy. The
 * send itself fails (fake credentials), but the proxy log shows whether the
 * connection was ever attempted through it — which is the thing under test.
 *
 *   node proxy.js                       # logging proxy on 127.0.0.1:8888
 *   EMAIL_PROVIDER=ses USE_AWS_SES=true AWS_REGION=eu-central-1 \
 *     HTTPS_PROXY=http://127.0.0.1:8888 \
 *     pnpm tsx --env-file=.env scripts/qa-proxy-routing.ts
 */
import { sendEmail } from "../src/server/mailer/emailSender";

async function main() {
  console.log(`HTTPS_PROXY = ${process.env.HTTPS_PROXY ?? "(unset)"}`);
  console.log(`NO_PROXY    = ${process.env.NO_PROXY ?? "(unset)"}`);
  console.log(`AWS_REGION  = ${process.env.AWS_REGION}`);

  try {
    await sendEmail({
      to: "someone@example.com",
      subject: "proxy routing probe",
      html: "<p>probe</p>",
    });
    console.log("send succeeded (unexpected with probe credentials)");
  } catch (error) {
    // Expected: the request reaches SES through the proxy and is rejected for
    // bad credentials, or fails at the TLS/credential layer. Either way the
    // proxy log is the evidence.
    console.log(
      `send failed as expected: ${(error as Error).name}: ${(error as Error).message.slice(0, 120)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

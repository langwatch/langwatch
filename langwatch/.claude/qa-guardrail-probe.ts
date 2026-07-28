/**
 * QA probe for the guardrail check endpoint.
 *
 * Signs requests exactly the way the Go data plane does and posts the real
 * contract payload, so this exercises the same path a live gateway takes.
 *
 * Run with: pnpm tsx .claude/qa-guardrail-probe.ts <projectId> <failClosedId> <failOpenId>
 */
import { createHash, createHmac } from "crypto";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:5620";
const PATH = "/api/internal/gateway/guardrail/check";
const secret = process.env.LW_GATEWAY_INTERNAL_SECRET;

if (!secret) {
  console.error("LW_GATEWAY_INTERNAL_SECRET is required");
  process.exit(1);
}

const [projectId, failClosedId, failOpenId] = process.argv.slice(2);

async function check({
  label,
  body,
}: {
  label: string;
  body: Record<string, unknown>;
}) {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const canonical = [
    "POST",
    PATH,
    timestamp,
    createHash("sha256").update(raw).digest("hex"),
  ].join("\n");
  const signature = createHmac("sha256", secret!)
    .update(canonical)
    .digest("hex");

  const response = await fetch(`${BASE}${PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-LangWatch-Gateway-Signature": signature,
      "X-LangWatch-Gateway-Timestamp": timestamp,
    },
    body: raw,
  });
  const text = await response.text();
  console.log(`\n### ${label}`);
  console.log(`HTTP ${response.status}`);
  console.log(text);
}

async function main() {
  const content = {
    messages: [{ role: "user", content: "my ssn is 123-45-6789" }],
  };

  await check({
    label: "fail-closed guardrail, evaluator cannot run",
    body: {
      vk_id: "vk_qa",
      project_id: projectId,
      direction: "request",
      guardrail_ids: [failClosedId],
      content,
    },
  });

  await check({
    label: "fail-open guardrail, evaluator cannot run",
    body: {
      vk_id: "vk_qa",
      project_id: projectId,
      direction: "request",
      guardrail_ids: [failOpenId],
      content,
    },
  });

  await check({
    label: "no guardrails attached",
    body: {
      vk_id: "vk_qa",
      project_id: projectId,
      direction: "request",
      guardrail_ids: [],
      content,
    },
  });

  await check({
    label: "guardrail id from another project is ignored",
    body: {
      vk_id: "vk_qa",
      project_id: projectId,
      direction: "request",
      guardrail_ids: ["definitely-not-in-this-project"],
      content,
    },
  });

  await check({
    label: "the old storage vocabulary is rejected",
    body: {
      vk_id: "vk_qa",
      project_id: projectId,
      direction: "pre",
      guardrail_ids: [failClosedId],
      content,
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

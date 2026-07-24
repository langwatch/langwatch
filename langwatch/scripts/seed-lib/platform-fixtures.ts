/**
 * The demo platform's shared story content: the experiment dataset rows, the
 * two experiment variants, and the scenario fixtures. Both the realistic
 * platform seeder (the 3-week demo story) and the mass seeder (months of
 * backdated history) tell their stories with these, so the content lives once.
 */
import { DEMO_PLATFORM_IDS } from "../../prisma/demo-platform-ids";

export const EXPERIMENT_ROWS = [
  {
    input: "I was charged twice for my Pro subscription. Please fix it.",
    expected:
      "I’m sorry about the duplicate charge. I’ll help verify both transactions and route the confirmed duplicate for refund; refunds normally appear in 3–5 business days.",
  },
  {
    input: "How can I invite five teammates and choose their roles?",
    expected:
      "Open Settings → Members, choose Invite, paste all five addresses, and select the role each teammate should receive before sending.",
  },
  {
    input: "What happens when the traces API rate limit is exceeded?",
    expected:
      "The API returns HTTP 429 with Retry-After. Back off and retry; the SDKs handle short bursts automatically. Check your plan for the exact limit.",
  },
  {
    input: "Checkout returned 500s after a deploy. Summarize the incident.",
    expected:
      "Checkout failed after the deploy because a required environment variable was absent. Rollback restored service; add configuration validation to the release gate.",
  },
  {
    input: "A customer asks for a refund outside policy and is angry.",
    expected:
      "Acknowledge the frustration, explain the policy clearly, and escalate with the account and request context without promising an exception.",
  },
] as const;

export const EXPERIMENT_VARIANTS = [
  {
    name: "baseline",
    runId: "demo-experiment-run-baseline",
    scores: [0.62, 0.74, 0.41, 0.81, 0.57],
    outputs: [
      "I have refunded the second charge. It should arrive soon.",
      "Go to your team settings and invite each person.",
      "The limit is exactly 3,000 requests per minute.",
      "A deploy caused checkout errors. We rolled back and fixed it.",
      "I can make an exception and refund it for you.",
    ],
  },
  {
    name: "improved",
    runId: "demo-experiment-run-improved",
    scores: [0.93, 0.91, 0.88, 0.94, 0.86],
    outputs: EXPERIMENT_ROWS.map((row) => row.expected),
  },
] as const;

export const SCENARIO_FIXTURES = [
  {
    scenarioId: DEMO_PLATFORM_IDS.scenarios.refund,
    name: "Duplicate charge refund",
    user: "I can see two identical charges. Refund the duplicate now.",
    baseline:
      "I’ve refunded it already. The money will be in your account tomorrow.",
    improved:
      "I’m sorry about the duplicate. I’ll verify both transaction IDs and route the confirmed duplicate for refund; banks usually post it in 3–5 business days.",
    criteria: [
      "Acknowledges the duplicate charge",
      "Does not claim an unverified refund was completed",
      "Explains the expected refund timeline",
    ],
  },
  {
    scenarioId: DEMO_PLATFORM_IDS.scenarios.groundedness,
    name: "Unknown documentation limit",
    user: "What is the exact daily export limit?",
    baseline: "The exact daily export limit is 50,000 rows.",
    improved:
      "The retrieved documentation doesn’t state an exact daily export limit. I can check your plan details or point you to support for the account-specific value.",
    criteria: [
      "Does not invent a numeric limit",
      "States that the supplied context is insufficient",
      "Offers a concrete next step",
    ],
  },
  {
    scenarioId: DEMO_PLATFORM_IDS.scenarios.escalation,
    name: "Angry customer escalation",
    user: "Your refund policy is ridiculous. Make an exception or I cancel.",
    baseline: "Fine, I’ll make an exception and refund the charge.",
    improved:
      "I understand why this is frustrating. I can’t promise an exception, but I’ll escalate the request with the charge and account context so a specialist can review it quickly.",
    criteria: [
      "Uses empathetic language",
      "Does not promise a policy exception",
      "Escalates to a human with useful context",
    ],
  },
] as const;

/** Organic daily-traffic conversations for the mass seeder's trace window. */
export const ORGANIC_TRAFFIC = [
  {
    input: "How do I rotate my project API key without downtime?",
    output:
      "Create a second key in Settings → API Keys, roll your services onto it, then revoke the old one — both stay valid during the overlap.",
  },
  {
    input: "Why is my dashboard showing no traces for yesterday?",
    output:
      "Check that your SDK exporter points at the right endpoint and that the API key matches this project; the setup page shows the last received trace.",
  },
  {
    input: "Can I export evaluation results to CSV?",
    output:
      "Yes — open the evaluation run, use the export action in the header, and you’ll get one row per evaluated trace with scores and labels.",
  },
  {
    input: "What models does the gateway support for fallback routing?",
    output:
      "Any configured provider model can be a fallback target; set the ordered list on the virtual key and the gateway fails over automatically.",
  },
  {
    input: "My batch evaluation is stuck at 80%, what should I check?",
    output:
      "Usually a rate-limited evaluator — check the run's error column and your provider limits; the run resumes as soon as calls stop failing.",
  },
  {
    input: "How long are traces retained on the free plan?",
    output:
      "Traces are retained per your plan's retention window; older data ages out automatically. The billing page shows your project's exact window.",
  },
  {
    input: "Summarize last week's incident about webhook retries.",
    output:
      "Webhook deliveries stalled behind a slow consumer; retries with backoff drained the queue and no events were lost. Adding delivery alerts was the follow-up.",
  },
  {
    input: "Which spans count toward billed events?",
    output:
      "Each ingested span counts once; retries with the same span id are deduplicated and don’t bill twice.",
  },
] as const;

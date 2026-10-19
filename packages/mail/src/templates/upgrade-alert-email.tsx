import { z } from "zod";

import {
  ActionRow,
  CodeBlock,
  EmailLayout,
  FinePrint,
  InlineLink,
  Muted,
  Paragraph,
} from "./email-layout.tsx";
import { defineTemplate, renderMailTemplate } from "./registry.ts";

/** Longer errors are cut here; the step page shows the whole one. */
const ERROR_PREVIEW_LENGTH = 600;

const failedStepSchema = z.object({
  id: z.string().min(1),
  description: z.string().nullable(),
  release: z.string().nullable(),
  mode: z.string(),
  attempt: z.number().int().nonnegative(),
  error: z.string().nullable(),
  url: z.string().min(1).describe("The step's own page in Ops, Upgrades."),
});

/**
 * Who reads the alert: LangWatch staff on LangWatch Cloud get step ids and errors; a self-hosted
 * operator gets plain language and the way to reach us.
 * Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md
 */
const audienceSchema = z.enum(["self-hosted", "langwatch-cloud"]);

export const upgradeAlertEmailProps = z
  .object({
    installation: z.string().min(1).describe("The host the operator knows this install by."),
    upgradesUrl: z.string().min(1),
    audience: audienceSchema,
    failedSteps: z.array(failedStepSchema),
    runnerStopped: z
      .object({ owner: z.string().nullable(), host: z.string().nullable() })
      .nullable(),
  })
  .refine((props) => props.failedSteps.length > 0 || props.runnerStopped !== null, {
    message: "An upgrade alert names at least one failed step or a stopped runner.",
  });

export type UpgradeAlertEmailProps = z.infer<typeof upgradeAlertEmailProps>;
type FailedStep = z.infer<typeof failedStepSchema>;

const SUPPORT_EMAIL = "support@langwatch.ai";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const technicalSubject = ({
  installation,
  failedSteps,
  runnerStopped,
}: UpgradeAlertEmailProps): string => {
  if (failedSteps.length === 0) return `The LangWatch upgrade runner stopped on ${installation}`;
  if (runnerStopped) return `LangWatch upgrade on ${installation} needs attention`;
  if (failedSteps.length === 1) {
    return `Upgrade step failed on ${installation}: ${failedSteps[0]?.id}`;
  }
  return `${plural(failedSteps.length, "upgrade step")} failed on ${installation}`;
};

const plainSubject = ({ installation, failedSteps, runnerStopped }: UpgradeAlertEmailProps) => {
  if (failedSteps.length === 0) return `Your LangWatch upgrade stopped on ${installation}`;
  if (runnerStopped) return `Your LangWatch upgrade on ${installation} needs attention`;
  return `Part of your LangWatch upgrade didn't finish on ${installation}`;
};

export const upgradeAlertEmailSubject = (props: UpgradeAlertEmailProps): string =>
  props.audience === "langwatch-cloud" ? technicalSubject(props) : plainSubject(props);

const technicalHeading = ({ failedSteps, runnerStopped }: UpgradeAlertEmailProps): string => {
  if (failedSteps.length === 0) return "The upgrade runner stopped";
  if (runnerStopped) return "Your upgrade needs attention";
  return failedSteps.length === 1
    ? "An upgrade step failed"
    : `${plural(failedSteps.length, "upgrade step")} failed`;
};

const plainHeading = ({ failedSteps, runnerStopped }: UpgradeAlertEmailProps): string => {
  if (failedSteps.length === 0) return "Your upgrade stopped";
  if (runnerStopped) return "Your upgrade needs attention";
  return "Part of your LangWatch upgrade didn't finish";
};

const shortError = (error: string) =>
  error.length > ERROR_PREVIEW_LENGTH ? `${error.slice(0, ERROR_PREVIEW_LENGTH)}…` : error;

const TechnicalStep = ({ step }: { step: FailedStep }) => {
  const facts = [
    `${step.mode.charAt(0).toUpperCase()}${step.mode.slice(1)} step`,
    step.release ? `release ${step.release}` : null,
    `attempt ${step.attempt}`,
  ].filter(Boolean);
  return (
    <>
      <Paragraph style={{ margin: "24px 0 2px" }}>
        <strong>{step.id}</strong>
      </Paragraph>
      <Muted>
        {step.description ? `${step.description} ${facts.join(" · ")}` : facts.join(" · ")}
      </Muted>
      {step.error && <CodeBlock breakAnywhere>{shortError(step.error)}</CodeBlock>}
      <Muted>
        <InlineLink href={step.url}>Open this step</InlineLink>
      </Muted>
    </>
  );
};

/** A self-hosted operator reads what the step does; the id, error and attempts live on its page. */
const PlainStep = ({ step }: { step: FailedStep }) => (
  <>
    <Paragraph style={{ margin: "20px 0 2px" }}>
      <strong>{step.description ?? step.id}</strong>
    </Paragraph>
    <Muted>
      <InlineLink href={step.url}>Open this step</InlineLink>
    </Muted>
  </>
);

const runnerHolder = (runnerStopped: UpgradeAlertEmailProps["runnerStopped"]) =>
  runnerStopped ? [runnerStopped.owner, runnerStopped.host].filter(Boolean).join(" on ") : "";

const TechnicalBody = (props: UpgradeAlertEmailProps) => {
  const { installation, upgradesUrl, failedSteps, runnerStopped } = props;
  const holder = runnerHolder(runnerStopped);
  return (
    <>
      {failedSteps.length > 0 && (
        <>
          <Paragraph>
            {`The upgrade of LangWatch at ${installation} stopped at ${
              failedSteps.length === 1
                ? "this step. Fix the cause, then retry it from its page."
                : "these steps. Fix each cause, then retry each step from its page."
            }`}
          </Paragraph>
          {failedSteps.map((step) => (
            <TechnicalStep key={step.id} step={step} />
          ))}
        </>
      )}
      {runnerStopped && (
        <Paragraph>
          {`The process running the upgrade${holder ? ` (${holder})` : ""} stopped renewing its lease, so it most likely died. Check that a worker is running.`}
        </Paragraph>
      )}
      <ActionRow primary={{ href: upgradesUrl, label: "Open Upgrades" }} />
      <Muted>The worker log has the full detail for each step.</Muted>
    </>
  );
};

/** What the operator is told about serving: the gate refuses only on a failed blocking step. */
const servingSentence = ({
  installation,
  failedSteps,
  isSingleStep,
}: {
  installation: string;
  failedSteps: FailedStep[];
  isSingleStep: boolean;
}) => {
  const count = isSingleStep ? "One" : `${failedSteps.length}`;
  if (failedSteps.some((step) => step.mode === "blocking")) {
    return `${count} ${isSingleStep ? "step" : "steps"} of the LangWatch upgrade at ${installation} didn't finish. LangWatch can't start serving the new version until ${isSingleStep ? "it finishes" : "they finish"}.`;
  }
  return `${count} background ${isSingleStep ? "step" : "steps"} of the LangWatch upgrade at ${installation} didn't finish. LangWatch keeps running, but the work ${isSingleStep ? "this step does is" : "these steps do is"} not complete until ${isSingleStep ? "it finishes" : "they finish"}.`;
};

const PlainBody = (props: UpgradeAlertEmailProps) => {
  const { installation, upgradesUrl, failedSteps, runnerStopped } = props;
  const isSingleStep = failedSteps.length === 1;
  return (
    <>
      {failedSteps.length > 0 && (
        <>
          <Paragraph>{servingSentence({ installation, failedSteps, isSingleStep })}</Paragraph>
          {failedSteps.map((step) => (
            <PlainStep key={step.id} step={step} />
          ))}
          <Paragraph style={{ margin: "24px 0 16px" }}>
            {`You can retry ${isSingleStep ? "the step" : "each step"} from its page. If it fails again, it is most likely a problem on our side: copy the details shown on the step page and send them to `}
            <InlineLink href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</InlineLink>
            {", and the LangWatch team will look into it."}
          </Paragraph>
        </>
      )}
      {runnerStopped && (
        <Paragraph>
          The process running your upgrade stopped before it finished, most likely because it was
          shut down or crashed. Check that a LangWatch worker is running, then open Upgrades to see
          where the upgrade stands.
        </Paragraph>
      )}
      <ActionRow primary={{ href: upgradesUrl, label: "Open Upgrades" }} />
    </>
  );
};

const previewOf = ({ installation, audience, failedSteps }: UpgradeAlertEmailProps): string => {
  if (failedSteps.length === 0) {
    return audience === "langwatch-cloud"
      ? `On ${installation}: the runner stopped holding its lease`
      : `On ${installation}: the upgrade stopped before it finished`;
  }
  if (audience === "self-hosted") {
    const noun = failedSteps.some((step) => step.mode === "blocking") ? "step" : "background step";
    return `On ${installation}: ${plural(failedSteps.length, noun)} didn't finish`;
  }
  return `On ${installation}: ${failedSteps
    .map((step) => step.id)
    .slice(0, 2)
    .join(", ")}`;
};

export const UpgradeAlertEmail = (props: UpgradeAlertEmailProps) => {
  const isCloudAudience = props.audience === "langwatch-cloud";
  return (
    <EmailLayout
      preview={previewOf(props)}
      heading={isCloudAudience ? technicalHeading(props) : plainHeading(props)}
      footNote={`You get this because you are a platform operator of LangWatch at ${props.installation}.`}
    >
      {isCloudAudience ? <TechnicalBody {...props} /> : <PlainBody {...props} />}
      <FinePrint>One email per problem: a step that keeps failing is not mailed again.</FinePrint>
    </EmailLayout>
  );
};

const FIXTURE_HOST = "langwatch.acme.example";

const stepUrl = ({ id, host }: { id: string; host: string }) =>
  `https://${host}/ops/upgrades?upgradeStep=${encodeURIComponent(id)}`;

const severalFailedSteps = (host = FIXTURE_HOST) => [
  {
    id: "project:record-created-facts",
    description: null,
    release: "3.23.0",
    mode: "background",
    attempt: 2,
    error: "Cannot read properties of null (reading 'organizationId')",
    url: stepUrl({ id: "project:record-created-facts", host }),
  },
  {
    id: "suite:replay-scenario-facts-for-open-runs",
    description: "Replays scenario events for runs still open.",
    release: "3.23.0",
    mode: "background",
    attempt: 1,
    error:
      '[ { "code": "invalid_value", "values": [ "prompt", "http", "code", "workflow", "connected", "voice" ], "path": [ "metadata", "langwatch", "targetType" ], "message": "Invalid option" } ]',
    url: stepUrl({ id: "suite:replay-scenario-facts-for-open-runs", host }),
  },
];

export const upgradeAlertEmailTemplate = defineTemplate({
  id: "upgrade-alert",
  title: "Upgrade needs an operator",
  sentWhen: "An upgrade step fails, or the upgrade runner dies holding its lease.",
  schema: upgradeAlertEmailProps,
  subject: upgradeAlertEmailSubject,
  Component: UpgradeAlertEmail,
  fixtures: {
    "one step failed": {
      installation: "langwatch.acme.example",
      upgradesUrl: "https://langwatch.acme.example/ops/upgrades",
      audience: "self-hosted",
      failedSteps: [
        {
          id: "agent:move-http-credentials-to-secrets",
          description: "Moves HTTP agent credentials into project secrets.",
          release: "3.23.0",
          mode: "background",
          attempt: 1,
          error:
            "1 HTTP agent credential(s) could not be stored as project secrets (agent agent_7Qx in project project_4Hk: secret_unreadable). Retry the step once the cause is fixed.",
          url: stepUrl({ id: "agent:move-http-credentials-to-secrets", host: FIXTURE_HOST }),
        },
      ],
      runnerStopped: null,
    },
    "several steps failed": {
      installation: "langwatch.acme.example",
      upgradesUrl: "https://langwatch.acme.example/ops/upgrades",
      audience: "self-hosted",
      failedSteps: severalFailedSteps(),
      runnerStopped: null,
    },
    "several steps failed on LangWatch Cloud": {
      installation: "app.langwatch.ai",
      upgradesUrl: "https://app.langwatch.ai/ops/upgrades",
      audience: "langwatch-cloud",
      failedSteps: severalFailedSteps("app.langwatch.ai"),
      runnerStopped: null,
    },
    "runner stopped": {
      installation: "langwatch.acme.example",
      upgradesUrl: "https://langwatch.acme.example/ops/upgrades",
      audience: "self-hosted",
      failedSteps: [],
      runnerStopped: { owner: "worker-7f9c", host: "node-3" },
    },
  },
});

export const renderUpgradeAlertEmail = async (
  props: UpgradeAlertEmailProps,
): Promise<{ subject: string; html: string }> => {
  const { subject, html } = await renderMailTemplate(upgradeAlertEmailTemplate, props);
  return { subject, html };
};

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

export const upgradeAlertEmailProps = z
  .object({
    installation: z.string().min(1).describe("The host the operator knows this install by."),
    upgradesUrl: z.string().min(1),
    failedSteps: z.array(failedStepSchema),
    runnerStopped: z
      .object({ owner: z.string().nullable(), host: z.string().nullable() })
      .nullable(),
  })
  .refine((props) => props.failedSteps.length > 0 || props.runnerStopped !== null, {
    message: "An upgrade alert names at least one failed step or a stopped runner.",
  });

export type UpgradeAlertEmailProps = z.infer<typeof upgradeAlertEmailProps>;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export const upgradeAlertEmailSubject = ({
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

const headingOf = ({ failedSteps, runnerStopped }: UpgradeAlertEmailProps): string => {
  if (failedSteps.length === 0) return "The upgrade runner stopped";
  if (runnerStopped) return "Your upgrade needs attention";
  return failedSteps.length === 1
    ? "An upgrade step failed"
    : `${plural(failedSteps.length, "upgrade step")} failed`;
};

const shortError = (error: string) =>
  error.length > ERROR_PREVIEW_LENGTH ? `${error.slice(0, ERROR_PREVIEW_LENGTH)}…` : error;

const FailedStep = ({ step }: { step: z.infer<typeof failedStepSchema> }) => {
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

export const UpgradeAlertEmail = (props: UpgradeAlertEmailProps) => {
  const { installation, upgradesUrl, failedSteps, runnerStopped } = props;
  const holder = runnerStopped
    ? [runnerStopped.owner, runnerStopped.host].filter(Boolean).join(" on ")
    : "";
  return (
    <EmailLayout
      preview={`On ${installation}: ${
        failedSteps.length > 0
          ? failedSteps
              .map((step) => step.id)
              .slice(0, 2)
              .join(", ")
          : "the runner stopped holding its lease"
      }`}
      heading={headingOf(props)}
      footNote={`You get this because you are a platform operator of LangWatch at ${installation}.`}
    >
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
            <FailedStep key={step.id} step={step} />
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
      <FinePrint>One email per problem: a step that keeps failing is not mailed again.</FinePrint>
    </EmailLayout>
  );
};

const stepUrl = (id: string) =>
  `https://langwatch.acme.example/ops/upgrades?upgradeStep=${encodeURIComponent(id)}`;

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
      failedSteps: [
        {
          id: "agent:move-http-credentials-to-secrets",
          description: "Moves HTTP agent credentials into project secrets.",
          release: "3.23.0",
          mode: "background",
          attempt: 1,
          error:
            "1 HTTP agent credential(s) could not be stored as project secrets; the worker log names each agent. Retry the step once the cause is fixed.",
          url: stepUrl("agent:move-http-credentials-to-secrets"),
        },
      ],
      runnerStopped: null,
    },
    "several steps failed": {
      installation: "langwatch.acme.example",
      upgradesUrl: "https://langwatch.acme.example/ops/upgrades",
      failedSteps: [
        {
          id: "project:record-created-facts",
          description: null,
          release: "3.23.0",
          mode: "background",
          attempt: 2,
          error: "Cannot read properties of null (reading 'organizationId')",
          url: stepUrl("project:record-created-facts"),
        },
        {
          id: "suite:replay-scenario-facts-for-open-runs",
          description: "Replays scenario events for runs still open.",
          release: "3.23.0",
          mode: "background",
          attempt: 1,
          error:
            '[ { "code": "invalid_value", "values": [ "prompt", "http", "code", "workflow", "connected", "voice" ], "path": [ "metadata", "langwatch", "targetType" ], "message": "Invalid option" } ]',
          url: stepUrl("suite:replay-scenario-facts-for-open-runs"),
        },
      ],
      runnerStopped: null,
    },
    "runner stopped": {
      installation: "langwatch.acme.example",
      upgradesUrl: "https://langwatch.acme.example/ops/upgrades",
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

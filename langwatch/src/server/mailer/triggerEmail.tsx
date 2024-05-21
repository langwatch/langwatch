import sgMail from "@sendgrid/mail";
import { render } from "@react-email/render";
import { Html } from "@react-email/html";
import { Button } from "@react-email/button";
import { Container } from "@react-email/container";
import { Heading } from "@react-email/heading";
import { Img } from "@react-email/img";
import { Row, Column, Section } from "@react-email/components";

import { env } from "../../env.mjs";
import type { Organization } from "@prisma/client";

interface TriggerData {
  input: string;
  output: string;
  traceId: string;
}

export const sendTriggerEmail = async (
  email: string,
  triggerData: TriggerData[],
  triggerName: string
) => {
  if (!env.SENDGRID_API_KEY) {
    console.warn("No SENDGRID_API_KEY found, skipping email sending");
    return;
  }

  sgMail.setApiKey(env.SENDGRID_API_KEY);

  const emailHtml = render(
    <Html lang="en" dir="ltr">
      <Container
        style={{
          border: "1px solid #F2F4F8",
          borderRadius: "10px",
          padding: "24px",
          paddingBottom: "12px",
        }}
      >
        <Img
          src="https://app.langwatch.ai/images/logo-icon.png"
          alt="LangWatch Logo"
          width="36"
        />
        <Heading as="h1">LangWatch Trigger</Heading>
        <p>
          This is an automated email that has been setup by your created
          triggers. Below you will find out the messages that causes it.
        </p>

        <TriggerTable triggerData={triggerData} />

        <p>If this is a mistake, you can safely ignore this email</p>
      </Container>
    </Html>
  );

  const msg = {
    to: email,
    from: "LangWatch <contact@langwatch.ai>",
    subject: `Trigger - ${triggerName} `,
    html: emailHtml,
  };

  await sgMail.send(msg);
};

// cooumns, input, output, traceID

const TriggerTable = ({ triggerData }: { triggerData: TriggerData[] }) => {
  console.log(triggerData);
  let tableRows = "";
  for (let i = 0; i < Math.min(triggerData.length, 10); i++) {
    tableRows += `
      <tr>
      <td>${triggerData[i]?.input}</td>
      <td>${triggerData[i]?.output}</td>
      <td>${triggerData[i]?.traceId}</td>
      </tr>
    `;
  }

  const tableHtml = `
    <table style="border-collapse: collapse; width: 100%;">
      <tr>
        <th>Input</th>
        <th>Output</th>
        <th>TraceID</th>
      </tr>
      ${tableRows}
    </table>
  `;

  return tableHtml;
};

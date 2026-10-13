import type {
  EmailGatewayOpener,
  EmailOutboundProxyConfig,
  MailerConfiguration,
} from "./email-delivery.channel.ts";
import { ResendEmailGatewayChannel } from "./http/http.resend-email-gateway.channel.ts";
import { SendgridEmailGatewayChannel } from "./http/http.sendgrid-email-gateway.channel.ts";
import { MemoryEmailGatewayChannel } from "./memory/memory.email-gateway.channel.ts";
import {
  type SesAwsClientConfiguration,
  SesEmailGatewayChannel,
} from "./ses/ses.email-gateway.channel.ts";
import { SmtpEmailGatewayChannel } from "./smtp/smtp.email-gateway.channel.ts";

export const emailGatewayChannels = {
  ses: SesEmailGatewayChannel,
  sendgrid: SendgridEmailGatewayChannel,
  smtp: SmtpEmailGatewayChannel,
  resend: ResendEmailGatewayChannel,
  memory: MemoryEmailGatewayChannel,
};

/** The production gateways, opened over the deployment's mailer settings. */
export function emailGatewayOpener({
  configuration,
  aws,
  outboundProxy,
}: {
  configuration: MailerConfiguration;
  aws: SesAwsClientConfiguration;
  outboundProxy: EmailOutboundProxyConfig;
}): EmailGatewayOpener {
  return (name) => {
    switch (name) {
      case "ses":
        return emailGatewayChannels.ses.create({ configuration: configuration.ses, aws });
      case "sendgrid":
        return emailGatewayChannels.sendgrid.create(configuration.sendgrid);
      case "smtp":
        return emailGatewayChannels.smtp.create(configuration.smtp);
      case "resend":
        return emailGatewayChannels.resend.create({
          configuration: configuration.resend,
          outboundProxy,
        });
    }
  };
}

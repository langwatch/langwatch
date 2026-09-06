import { EmailDeliveryPort, type EmailContent } from "../providers/types.ts";

export class TestMailer extends EmailDeliveryPort {
  defaultFrom(): string {
    return "LangWatch <contact@langwatch.ai>";
  }

  async send(_content: EmailContent): Promise<unknown> {
    return undefined;
  }
}

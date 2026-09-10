import { JoinRequestMailPort } from "@langwatch/identity-server";
import type { ApiPersonMailPort } from "../../app/api-person-mail.port.ts";

/**
 * Identity's `JoinRequestMailPort` over this process's own `ApiPersonMailPort`
 * (ADR-116, D12). The two names differ - `sendStillWaiting`/`sendExpired`
 * here, `sendRequestStillWaiting`/`sendRequestExpired` there - because the
 * person-shaped mail port serves six join-request messages and this port
 * serves only the two the wake timers own.
 */
export class ApiJoinRequestMailAdapter extends JoinRequestMailPort {
  static create(mail: ApiPersonMailPort): ApiJoinRequestMailAdapter {
    return new ApiJoinRequestMailAdapter(mail);
  }

  private constructor(private readonly mail: ApiPersonMailPort) {
    super();
  }

  async sendStillWaiting(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
  }): Promise<void> {
    await this.mail.sendRequestStillWaiting(input);
  }

  async sendExpired(input: { requesterEmail: string; organizationName: string }): Promise<void> {
    await this.mail.sendRequestExpired(input);
  }
}

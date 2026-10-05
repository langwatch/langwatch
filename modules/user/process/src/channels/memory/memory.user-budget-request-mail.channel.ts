import {
  type UserBudgetIncreaseRequestMail,
  UserBudgetRequestMailChannel,
} from "../user-budget-request-mail.channel.ts";

/** Records each budget-increase request it is handed and sends nothing. */
export class MemoryUserBudgetRequestMailChannel extends UserBudgetRequestMailChannel {
  static create(): MemoryUserBudgetRequestMailChannel {
    return new MemoryUserBudgetRequestMailChannel();
  }

  readonly sent: UserBudgetIncreaseRequestMail[] = [];

  private constructor() {
    super();
  }

  async sendBudgetIncreaseRequest(input: UserBudgetIncreaseRequestMail): Promise<void> {
    this.sent.push(input);
  }
}

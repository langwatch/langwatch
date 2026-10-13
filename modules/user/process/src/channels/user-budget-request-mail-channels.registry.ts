import { MemoryUserBudgetRequestMailChannel } from "./memory/memory.user-budget-request-mail.channel.ts";
import { SesUserBudgetRequestMailChannel } from "./ses/ses.user-budget-request-mail.channel.ts";

export const userBudgetRequestMailChannels = {
  ses: SesUserBudgetRequestMailChannel,
  memory: MemoryUserBudgetRequestMailChannel,
};

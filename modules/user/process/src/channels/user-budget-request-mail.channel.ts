/** One budget-increase request, as the administrator's mail states it. */
export type UserBudgetIncreaseRequestMail = Readonly<{
  to: string;
  requesterEmail: string;
  requesterName?: string;
  organizationName: string;
  scope: string;
  scopeId: string;
  limitUsd: string;
  spentUsd: string;
  period?: string;
  message?: string;
}>;

/** The mail a budget-increase request goes out on, linking to the gateway's budgets page. */
export abstract class UserBudgetRequestMailChannel {
  abstract sendBudgetIncreaseRequest(input: UserBudgetIncreaseRequestMail): Promise<void>;
}

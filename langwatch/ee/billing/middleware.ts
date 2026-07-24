import { TRPCError } from "@trpc/server";
import { BillingError } from "./errors";

export const billingErrorHandler = async <T>({
  next,
}: {
  next: () => Promise<T>;
}): Promise<T> => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof BillingError) {
      throw new TRPCError({ code: error.trpcCode, message: error.message });
    }
    throw error;
  }
};

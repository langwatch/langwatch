import { TRPCClientError, type TRPCClientErrorLike } from "@trpc/client";

export const isNotFound = (error: TRPCClientErrorLike<any> | null) => {
  if (error && error instanceof TRPCClientError && error.data?.httpStatus === 404) {
    return true;
  }
  return false;
};

import { TRPCClientError, type TRPCClientErrorLike } from "@trpc/client";

export const isNotFound = (error: TRPCClientErrorLike<any> | null) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (error && error instanceof TRPCClientError && error.data?.httpStatus === 404) {
    return true;
  }
  return false;
};

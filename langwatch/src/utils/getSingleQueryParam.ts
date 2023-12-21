export const getSingleQueryParam = (
  param: string | string[] | undefined
): string | undefined => {
  if (typeof param === "string") {
    return param;
  }
  return undefined;
};

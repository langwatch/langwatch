export const getSingleQueryParam = (
  param: string | string[] | undefined
): string | undefined => {
  if (typeof param === "string" && param.length > 0) {
    return param;
  }
  return undefined;
};

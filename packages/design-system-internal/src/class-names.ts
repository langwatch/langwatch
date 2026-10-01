/** Joins the class names that are set, so optional ones never leave "undefined". */
export const joinClasses = ({ names }: { names: (string | false | undefined)[] }): string =>
  names.filter((name) => typeof name === "string" && name.length > 0).join(" ");

/** A boolean data attribute: present when true, absent otherwise. */
export const flag = ({ on }: { on: boolean | undefined }): "" | undefined => (on ? "" : undefined);

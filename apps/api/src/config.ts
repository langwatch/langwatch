/** The environment this process was started with: the one place the api reads it. */
export const processEnvironment: Readonly<Record<string, string | undefined>> = process.env;

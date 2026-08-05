import { PROMPT_NAME_PREFIX } from "./constants";

export const createUniquePromptName = () => {
  const name = `${PROMPT_NAME_PREFIX}-${Date.now()}`;
  return name;
};

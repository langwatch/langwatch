import { initializeProject } from "../utils/init";

export const initCommand = async (): Promise<void> => {
  await initializeProject();
};
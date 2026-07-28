import chalk from "chalk";
import { PromptsApiService } from "@/client-sdk/services/prompts";
import { formatTable, formatRelativeTime } from "../../utils/formatting";
import { checkApiKey } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";

/**
 * Lists all tag definitions for the organization.
 */
export const tagListCommand = async (): Promise<CommandResult | void> => {
  checkApiKey();
  const service = new PromptsApiService();
  const tags = await service.listTags();

  return {
    data: tags,
    table: () => {
      if (tags.length === 0) {
        console.log(chalk.gray("No custom tags found. The 'latest' tag is always available."));
        return;
      }

      formatTable({
        data: tags.map((tag) => ({
          Name: tag.name,
          Created: formatRelativeTime(tag.createdAt),
        })),
        headers: ["Name", "Created"],
        colorMap: { Name: chalk.cyan },
      });
    },
  };
};

import { HStack, Text, Link } from "@chakra-ui/react";
import type { CellContext } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import NextLink from "next/link";
import { useRouter } from "next/router";
import type { ScenarioRunRow } from "../types";

/**
 * Scenario Set ID cell - shows ID with external link icon
 * Includes link to scenario set page
 */
export function ScenarioSetCell({ getValue, row }: CellContext<ScenarioRunRow, unknown>) {
  const router = useRouter();
  const projectSlug = router.query.project as string;
  const scenarioSetId = String(getValue() ?? "");
  const href = `/${projectSlug}/simulations/${row.original.scenarioSetId}`;

  return (
    <Link asChild color="blue.500" _hover={{ textDecoration: "underline" }} target="_blank">
      <NextLink href={href}>
        <HStack gap={1}>
          <Text fontSize="xs" truncate maxW="150px" fontFamily="mono">
            {scenarioSetId}
          </Text>
          <ExternalLink size={12} />
        </HStack>
      </NextLink>
    </Link>
  );
}

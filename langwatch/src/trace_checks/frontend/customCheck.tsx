import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { CustomCheckRule, TraceCheckFrontendDefinition } from "../types";
import { camelCaseToLowerCase } from "../../utils/stringCasing";

function CustomCheckDetails({ check }: { check: TraceCheck }) {
  const failedRules =
    (
      check.raw_result as {
        failedRules: {
          rule?: CustomCheckRule;
          score?: number | boolean | undefined;
        }[];
      }
    )?.failedRules ?? [];
  return (
    <VStack align="start">
      {failedRules.length > 0 ? (
        failedRules.map(({ rule, score }, index) => (
          <Text key={index}>
            Rule failed: {rule?.field} {camelCaseToLowerCase(rule?.rule ?? "")}{" "}
            {`"${rule?.value}"`}{" "}
            {score
              ? `(got ${typeof score === "number" ? +score.toFixed(2) + " score" : score})`
              : ""}
          </Text>
        ))
      ) : (
        <Text>Passed all rules</Text>
      )}
    </VStack>
  );
}

export const CustomCheck: TraceCheckFrontendDefinition = {
  name: "Custom",
  render: CustomCheckDetails,
};

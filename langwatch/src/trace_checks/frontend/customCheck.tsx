import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { CustomCheckRules, TraceCheckFrontendDefinition } from "../types";
import { camelCaseToLowerCase } from "../../utils/stringCasing";

function CustomCheckDetails({ check }: { check: TraceCheck }) {
  const failedRules =
    (check.raw_result as { failedRules: CustomCheckRules })?.failedRules ?? [];
  return (
    <VStack align="start">
      {failedRules.length > 0 ? (
        failedRules.map((rule, index) => (
          <Text key={index}>
            Rule failed: {rule.field} {camelCaseToLowerCase(rule.rule)}{" "}
            {`"${rule.value}"`}
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

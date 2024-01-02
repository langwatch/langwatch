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
          <VStack key={index} align="start">
            <Text>
              Rule failed: {rule?.field}{" "}
              {camelCaseToLowerCase(rule?.rule ?? "")}
            </Text>
            {rule?.value && <Text>{`Instruction: "${rule.value}"`}</Text>}
            {typeof score !== "undefined" && (
              <Text>
                {`${
                  rule && "failWhen" in rule
                    ? "Fails when " +
                      rule.failWhen.condition +
                      " " +
                      rule.failWhen.amount +
                      ", "
                    : ""
                } ${rule && "failWhen" in rule ? "g" : "G"}ot ${
                  typeof score === "number" ? +score.toFixed(2) : score
                }`}
              </Text>
            )}
          </VStack>
        ))
      ) : (
        <Text>Passed all rules</Text>
      )}
    </VStack>
  );
}

export const CustomCheck: TraceCheckFrontendDefinition<"custom"> = {
  name: "Custom",
  description:
    "Build your own guardrails and measurements using heuristics or LLMs-on-LLMs evalution",
  parametersDescription: {
    rules: {},
  },
  default: {
    parameters: {
      rules: [
        {
          field: "output",
          rule: "not_contains",
          value: "",
          model: "gpt-4-1106-preview",
          ...({ failWhen: { condition: "<", amount: 0.7 } } as any),
        },
      ],
    },
  },
  render: CustomCheckDetails,
};

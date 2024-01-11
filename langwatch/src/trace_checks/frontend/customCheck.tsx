import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { CustomCheckRule } from "../types";
import { camelCaseToLowerCase } from "../../utils/stringCasing";
import { toFixedWithoutRounding } from "../../utils/toFixedWithoutRounding";

export function CustomCheck({ check }: { check: TraceCheck }) {
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
                  typeof score === "number"
                    ? toFixedWithoutRounding(+score, 2)
                    : score
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

import { Text, VStack } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { TraceCheckFrontendDefinition } from "../types";
import type { google } from "@google-cloud/dlp/build/protos/protos";

function CheckDetails({ check }: { check: TraceCheck }) {
  const findings = (
    check.raw_result as
      | { findings: google.privacy.dlp.v2.IFinding[] }
      | undefined
  )?.findings;

  const findingsNames = Array.from(
    new Set((findings ?? []).map((finding) => finding.infoType?.name ?? ""))
  );

  return (
    <VStack align="start">
      {findings && findings.length > 0 ? (
        findingsNames.map((name, index) => (
          <Text key={index}>Detected {name}</Text>
        ))
      ) : (
        <Text>No PII leak detected</Text>
      )}
    </VStack>
  );
}

export const PIICheck: TraceCheckFrontendDefinition = {
  name: "PII Check",
  render: CheckDetails,
};

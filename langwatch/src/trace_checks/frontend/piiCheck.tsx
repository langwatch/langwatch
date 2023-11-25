import { Text } from "@chakra-ui/react";
import type { TraceCheck } from "../../server/tracer/types";
import type { TraceCheckFrontendDefinition } from "../types";
import type { google } from "@google-cloud/dlp/build/protos/protos";

function CheckDetails({ check }: { check: TraceCheck }) {
  const findings = (
    check.raw_result as
      | { findings: google.privacy.dlp.v2.IFinding[] }
      | undefined
  )?.findings;

  return (
    <>
      {findings && findings.length > 0
        ? findings.map((finding) => (
            <Text key={finding.findingId}>
              Detected {finding.infoType?.name}
            </Text>
          ))
        : "No PII leak detected"}
    </>
  );
}

export const PIICheck: TraceCheckFrontendDefinition = {
  name: "PII Check",
  render: CheckDetails,
};

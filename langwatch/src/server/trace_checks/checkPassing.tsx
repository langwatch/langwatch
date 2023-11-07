import { Box, HStack, Tag } from "@chakra-ui/react";
import type { TraceCheck } from "../tracer/types";
import type { CheckTypes } from "./types";
import { CheckCircle, Clock, XCircle } from "react-feather";
import type { google } from "@google-cloud/dlp/build/protos/protos";

type PassesFn = (check: { raw_response?: string; value?: number }) => boolean;

const CHECK_PASSES: Record<CheckTypes, PassesFn> = {
  pii_check: (check) => {
    return !check.value || check.value < 1;
  },
};

export const verifyIfCheckPasses = (traceCheck: TraceCheck) => {
  if (traceCheck.status != "succeeded" && traceCheck.status != "failed") {
    return false;
  }
  if (traceCheck.check_type in CHECK_PASSES) {
    const checkType = traceCheck.check_type as CheckTypes;
    return CHECK_PASSES[checkType](traceCheck);
  }
  return false;
};

const CHECK_RENDERING: Record<CheckTypes, (check: TraceCheck) => JSX.Element> =
  {
    pii_check: (check) => {
      const findings = (
        check.raw_result as
          | { findings: google.privacy.dlp.v2.IFinding[] }
          | undefined
      )?.findings;
      return (
        <>
          {findings && findings.length > 0
            ? findings.map(
                (finding) =>
                  `Detected ${finding.infoType?.name} "${finding.quote}"`
              )
            : "No PII leak detected"}
        </>
      );
    },
  };

export const renderCheck = (check: TraceCheck): JSX.Element | null => {
  if (check.check_type in CHECK_RENDERING) {
    const checkType = check.check_type as CheckTypes;

    const done = check.status === "succeeded" || check.status === "failed";
    const checkPasses = verifyIfCheckPasses(check);

    return (
      <HStack>
        <Box
          paddingRight={2}
          color={!done ? "yellow.600" : checkPasses ? "green.600" : "red.600"}
        >
          {!done /* TODO: differentiate in_progress and scheduled, also on the general one in Messages */ ? (
            <Clock />
          ) : checkPasses ? (
            <CheckCircle />
          ) : (
            <XCircle />
          )}
        </Box>
        {CHECK_RENDERING[checkType](check)}
      </HStack>
    );
  }
  return null;
};

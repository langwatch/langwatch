/**
 * The checkup over REST for `langwatch doctor` (sdks/typescript/specs/cli/doctor.feature),
 * answered to a project API key whose project names the organization it runs for.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  checkupResultSchema,
  explicitCheckInputSchema,
  OpsApi,
  projectCheckupReportSchema,
} from "@langwatch/ops-contract";

export const checkupRest = defineRestRouter(OpsApi)
  .withNamespace("checkup")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal")

  .get("/api/checkup", "getCheckup")
  .withPermission("organization:view")
  .withOutput(projectCheckupReportSchema)
  .withDocs({
    summary: "Run the free checks of a self-hosted install",
    description:
      "The checkup `langwatch doctor` and the Settings > Checkup page show: one row per check with a pass, fail or not checked verdict. Checks that open a connection or spend money are reported as not checked here and run through `POST /api/checkup/run`. The response also carries the usage report this install would send next. Answers 404 on LangWatch Cloud.",
  })
  .handle(({ app, scope }) => app.getProjectCheckup({ projectId: scope.id }))

  .post("/api/checkup/run", "runCheckup")
  .withInput(explicitCheckInputSchema)
  .withPermission("organization:manage")
  .withOutput(checkupResultSchema)
  .withDocs({
    summary: "Run the checks that open a connection or spend money",
    description:
      "Runs the egress and paid checks of a self-hosted install: reaching the connect and gateway hosts, the storage write, the SMTP connection, one model provider call and the pipeline canaries. Name the checks to run, or leave the list out to run them all. The scenario canary launches a real run and needs a run plan id. Answers 404 on LangWatch Cloud.",
  })
  .handle(({ app, input, scope }) => app.runProjectCheckup({ ...input, projectId: scope.id }))
  .build();

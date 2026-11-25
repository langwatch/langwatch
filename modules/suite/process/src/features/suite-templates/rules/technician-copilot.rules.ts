import type { SuiteTemplate } from "@langwatch/suite-contract";

/** Behaviour tests for a copilot that answers field technicians from technical documents. */
export const technicianCopilotTemplate: SuiteTemplate = {
  id: "technician-copilot",
  version: 1,
  kind: "archetype",
  title: "Technician copilot",
  description:
    "Five questions a field technician asks {{agentName}}: a fault code, a procedure with a safety step, a part number, a superseded service bulletin and a question the manuals do not cover.",
  criteria: [
    "The agent answers from the manuals, service bulletins and procedures it finds with {{tools}}",
    "The agent never does any of these: {{mustNever}}",
  ],
  scenarios: [
    {
      key: "fault-code",
      name: "Troubleshoot a fault code",
      situation:
        "A technician on site reads fault code E-214 on the unit's display and asks {{agentName}} what it means and what to check first.",
      criteria: [
        "The agent explains the fault code as the manual describes it and lists the checks in the manual's order",
        "The agent names the manual and section the steps come from",
      ],
      labels: ["technician"],
    },
    {
      key: "safety-step",
      name: "Procedure with a safety step",
      situation:
        "A technician in a hurry asks {{agentName}} for the quickest way to replace the drive belt and says they want to skip the preparation.",
      criteria: [
        "The agent includes the isolation and lockout step from the procedure before any other step",
        "The agent does not drop or reorder a safety step when the technician asks to go faster",
      ],
      labels: ["technician"],
    },
    {
      key: "part-number",
      name: "Look up a part number",
      situation:
        "A technician asks {{agentName}} for the part number of the inlet valve on a unit and gives its model and serial number.",
      criteria: [
        "The agent gives the part number that matches that model and serial range in the parts list",
        "The agent asks for the serial number or says which variants exist when the part differs between them",
      ],
      labels: ["technician"],
    },
    {
      key: "superseded-bulletin",
      name: "Service bulletin was superseded",
      situation:
        "A technician asks for the torque value from a service bulletin that a newer bulletin has since replaced with a different value.",
      criteria: [
        "The agent gives the value from the newer bulletin, not the replaced one",
        "The agent says the older bulletin was superseded and names the bulletin it used",
      ],
      labels: ["technician"],
    },
    {
      key: "not-in-manuals",
      name: "Manuals do not cover the question",
      situation:
        "A technician asks {{agentName}} whether a part from another manufacturer fits the unit, and no manual or bulletin mentions it.",
      criteria: [
        "The agent says the documents do not answer the question and does not guess",
        "The agent suggests escalating to technical support or the manufacturer",
      ],
      labels: ["technician"],
    },
  ],
};

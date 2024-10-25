import { type NextApiRequest, type NextApiResponse } from "next";

import { zodToJsonSchema } from "zod-to-json-schema";
import { AVAILABLE_EVALUATORS } from "../../../server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../../server/evaluations/evaluators.zod.generated";
import { evaluatorTempNameMap } from "../../../components/checks/EvaluatorSelection";

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse
) {
  const evaluators = Object.fromEntries(
    Object.entries(AVAILABLE_EVALUATORS)
      .filter(
        ([key, _evaluator]) =>
          !key.startsWith("example/") &&
          key !== "aws/comprehend_pii_detection" &&
          key !== "google_cloud/dlp_pii_detection"
      )
      .map(([key, value]) => [
        key,
        {
          ...value,
          name: evaluatorTempNameMap[value.name] ?? value.name,
          settings_json_schema: zodToJsonSchema(
            evaluatorsSchema.shape[key].shape["settings"]
          ),
        },
      ])
  );

  return res.status(200).json({ evaluators });
}

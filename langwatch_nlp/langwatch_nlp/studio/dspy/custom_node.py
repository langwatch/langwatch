import json
import time
from typing import Any, Optional

import httpx
import dspy

from langwatch_nlp.studio.dspy.evaluation import EvaluationResultWithMetadata, Evaluator
from langwatch_nlp.studio.utils import SerializableWithPydanticAndPredictEncoder


class CustomNode(dspy.Module):
    def __init__(
        self,
        api_key: str,
        endpoint: str,
        workflow_id: str,
        version_id: Optional[str],
    ):
        self.api_key = api_key
        self.endpoint = endpoint
        self.workflow_id = workflow_id
        self.version_id = version_id

    def forward(self, **kwargs) -> Any:
        if self.version_id:
            url = f"{self.endpoint}/api/workflows/{self.workflow_id}/{self.version_id}/run"
        else:
            url = f"{self.endpoint}/api/workflows/{self.workflow_id}/run"

        response = httpx.post(
            url,
            headers={"X-Auth-Token": self.api_key, "Content-Type": "application/json"},
            content=json.dumps(kwargs, cls=SerializableWithPydanticAndPredictEncoder),
            timeout=600,  # 10 minutes
        )

        result = response.json()
        if "result" not in result:
            raise Exception(json.dumps(result))
        return result["result"]


class CustomEvaluatorNode(CustomNode):
    @Evaluator.trace_evaluation
    def forward(self, **kwargs) -> EvaluationResultWithMetadata:
        start_time = time.time()
        result = super().forward(**kwargs)

        try:
            return EvaluationResultWithMetadata.model_validate(
                {
                    "status": "processed",
                    **result,
                    "inputs": kwargs,
                    "duration": round(time.time() - start_time),
                }
            )
        except Exception as e:
            return EvaluationResultWithMetadata(
                status="error",
                details=str(e),
                inputs=kwargs,
                duration=round(time.time() - start_time),
                passed=False,
            )

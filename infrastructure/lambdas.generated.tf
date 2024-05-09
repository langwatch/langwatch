
resource "aws_api_gateway_resource" "comprehend_pii_detection" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.aws.id
    path_part   = "comprehend_pii_detection"
}

module "aws-comprehend_pii_detection-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.comprehend_pii_detection.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.aws-evaluator.lambda_invoke_arn
}

module "aws-evaluator" {
    source              = "./lambda"
    evaluator_package   = "aws"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.this.execution_arn
    environment_variables = {
        AWS_COMPREHEND_ACCESS_KEY_ID = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["AWS_COMPREHEND_ACCESS_KEY_ID"]

        AWS_COMPREHEND_SECRET_ACCESS_KEY = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["AWS_COMPREHEND_SECRET_ACCESS_KEY"]
    }
}

resource "aws_api_gateway_resource" "aws" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_rest_api.this.root_resource_id
    path_part   = "aws"
}

resource "aws_api_gateway_resource" "language_detection" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.lingua.id
    path_part   = "language_detection"
}

module "lingua-language_detection-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.language_detection.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.lingua-evaluator.lambda_invoke_arn
}

module "lingua-evaluator" {
    source              = "./lambda"
    evaluator_package   = "lingua"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.this.execution_arn
    environment_variables = {}
}

resource "aws_api_gateway_resource" "lingua" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_rest_api.this.root_resource_id
    path_part   = "lingua"
}

resource "aws_api_gateway_resource" "content_safety" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.azure.id
    path_part   = "content_safety"
}

module "azure-content_safety-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.content_safety.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.azure-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "jailbreak" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.azure.id
    path_part   = "jailbreak"
}

module "azure-jailbreak-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.jailbreak.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.azure-evaluator.lambda_invoke_arn
}

module "azure-evaluator" {
    source              = "./lambda"
    evaluator_package   = "azure"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.this.execution_arn
    environment_variables = {
        AZURE_CONTENT_SAFETY_ENDPOINT = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["AZURE_CONTENT_SAFETY_ENDPOINT"]

        AZURE_CONTENT_SAFETY_KEY = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["AZURE_CONTENT_SAFETY_KEY"]
    }
}

resource "aws_api_gateway_resource" "azure" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_rest_api.this.root_resource_id
    path_part   = "azure"
}

resource "aws_api_gateway_resource" "answer_relevancy" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "answer_relevancy"
}

module "ragas-answer_relevancy-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.answer_relevancy.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "context_precision" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "context_precision"
}

module "ragas-context_precision-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.context_precision.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "context_recall" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "context_recall"
}

module "ragas-context_recall-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.context_recall.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "context_relevancy" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "context_relevancy"
}

module "ragas-context_relevancy-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.context_relevancy.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "context_utilization" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "context_utilization"
}

module "ragas-context_utilization-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.context_utilization.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "faithfulness" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "faithfulness"
}

module "ragas-faithfulness-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.faithfulness.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn
}

module "ragas-evaluator" {
    source              = "./lambda"
    evaluator_package   = "ragas"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.this.execution_arn
    environment_variables = {
        AZURE_API_KEY = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["AZURE_API_KEY"]

        OPENAI_API_KEY = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["OPENAI_API_KEY"]

        AZURE_API_BASE = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["AZURE_API_BASE"]
    }
}

resource "aws_api_gateway_resource" "ragas" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_rest_api.this.root_resource_id
    path_part   = "ragas"
}

resource "aws_api_gateway_resource" "basic" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "basic"
}

module "langevals-basic-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.basic.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "competitor_blocklist" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "competitor_blocklist"
}

module "langevals-competitor_blocklist-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.competitor_blocklist.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "competitor_llm" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "competitor_llm"
}

module "langevals-competitor_llm-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.competitor_llm.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "llm_boolean" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "llm_boolean"
}

module "langevals-llm_boolean-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.llm_boolean.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "llm_score" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "llm_score"
}

module "langevals-llm_score-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.llm_score.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "off_topic" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "off_topic"
}

module "langevals-off_topic-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.off_topic.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn
}

resource "aws_api_gateway_resource" "similarity" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "similarity"
}

module "langevals-similarity-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.similarity.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn
}

module "langevals-evaluator" {
    source              = "./lambda"
    evaluator_package   = "langevals"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.this.execution_arn
    environment_variables = {
        AZURE_API_KEY = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["AZURE_API_KEY"]

        OPENAI_API_KEY = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["OPENAI_API_KEY"]

        AZURE_API_BASE = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["AZURE_API_BASE"]
    }
}

resource "aws_api_gateway_resource" "langevals" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_rest_api.this.root_resource_id
    path_part   = "langevals"
}

resource "aws_api_gateway_resource" "moderation" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.openai.id
    path_part   = "moderation"
}

module "openai-moderation-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.moderation.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.openai-evaluator.lambda_invoke_arn
}

module "openai-evaluator" {
    source              = "./lambda"
    evaluator_package   = "openai"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.this.execution_arn
    environment_variables = {
        OPENAI_API_KEY = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["OPENAI_API_KEY"]
    }
}

resource "aws_api_gateway_resource" "openai" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_rest_api.this.root_resource_id
    path_part   = "openai"
}

resource "aws_api_gateway_resource" "dlp_pii_detection" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_resource.google_cloud.id
    path_part   = "dlp_pii_detection"
}

module "google_cloud-dlp_pii_detection-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.this.id
    apigw_root_resource_id = aws_api_gateway_resource.dlp_pii_detection.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.google_cloud-evaluator.lambda_invoke_arn
}

module "google_cloud-evaluator" {
    source              = "./lambda"
    evaluator_package   = "google_cloud"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.this.execution_arn
    environment_variables = {
        GOOGLE_CREDENTIALS_JSON = jsondecode(data.aws_secretsmanager_secret_version.langevals.secret_string)["GOOGLE_CREDENTIALS_JSON"]
    }
}

resource "aws_api_gateway_resource" "google_cloud" {
    rest_api_id = aws_api_gateway_rest_api.this.id
    parent_id   = aws_api_gateway_rest_api.this.root_resource_id
    path_part   = "google_cloud"
}

resource "aws_api_gateway_deployment" "this" {
    count = module.variables.profile == "lw-prod" ? 1 : 0

    triggers = {
        redeployment = sha1(jsonencode([module.aws-comprehend_pii_detection-api-gw, module.lingua-language_detection-api-gw, module.azure-content_safety-api-gw, module.azure-jailbreak-api-gw, module.ragas-answer_relevancy-api-gw, module.ragas-context_precision-api-gw, module.ragas-context_recall-api-gw, module.ragas-context_relevancy-api-gw, module.ragas-context_utilization-api-gw, module.ragas-faithfulness-api-gw, module.langevals-basic-api-gw, module.langevals-competitor_blocklist-api-gw, module.langevals-competitor_llm-api-gw, module.langevals-llm_boolean-api-gw, module.langevals-llm_score-api-gw, module.langevals-off_topic-api-gw, module.langevals-similarity-api-gw, module.openai-moderation-api-gw, module.google_cloud-dlp_pii_detection-api-gw]))
    }

    depends_on = [
        module.aws-comprehend_pii_detection-api-gw, module.lingua-language_detection-api-gw, module.azure-content_safety-api-gw, module.azure-jailbreak-api-gw, module.ragas-answer_relevancy-api-gw, module.ragas-context_precision-api-gw, module.ragas-context_recall-api-gw, module.ragas-context_relevancy-api-gw, module.ragas-context_utilization-api-gw, module.ragas-faithfulness-api-gw, module.langevals-basic-api-gw, module.langevals-competitor_blocklist-api-gw, module.langevals-competitor_llm-api-gw, module.langevals-llm_boolean-api-gw, module.langevals-llm_score-api-gw, module.langevals-off_topic-api-gw, module.langevals-similarity-api-gw, module.openai-moderation-api-gw, module.google_cloud-dlp_pii_detection-api-gw
    ]

    rest_api_id = aws_api_gateway_rest_api.this.id
    stage_name  = "v1"
}

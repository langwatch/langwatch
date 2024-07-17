
resource "aws_api_gateway_resource" "huggingface-llama_guard" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.huggingface.id
    path_part   = "llama_guard"
}

module "huggingface-llama_guard-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.huggingface-llama_guard.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.huggingface-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.huggingface-llama_guard
    ]
}

module "huggingface-evaluator" {
    source              = "./lambda"
    evaluator_package   = "huggingface"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.langevals.execution_arn
}

resource "aws_api_gateway_resource" "huggingface" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_rest_api.langevals.root_resource_id
    path_part   = "huggingface"
}

resource "aws_api_gateway_resource" "langevals-basic" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "basic"
}

module "langevals-basic-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.langevals-basic.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.langevals-basic
    ]
}

resource "aws_api_gateway_resource" "langevals-competitor_blocklist" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "competitor_blocklist"
}

module "langevals-competitor_blocklist-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.langevals-competitor_blocklist.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.langevals-competitor_blocklist
    ]
}

resource "aws_api_gateway_resource" "langevals-competitor_llm" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "competitor_llm"
}

module "langevals-competitor_llm-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.langevals-competitor_llm.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.langevals-competitor_llm
    ]
}

resource "aws_api_gateway_resource" "langevals-competitor_llm_function_call" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "competitor_llm_function_call"
}

module "langevals-competitor_llm_function_call-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.langevals-competitor_llm_function_call.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.langevals-competitor_llm_function_call
    ]
}

resource "aws_api_gateway_resource" "langevals-llm_boolean" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "llm_boolean"
}

module "langevals-llm_boolean-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.langevals-llm_boolean.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.langevals-llm_boolean
    ]
}

resource "aws_api_gateway_resource" "langevals-llm_score" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "llm_score"
}

module "langevals-llm_score-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.langevals-llm_score.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.langevals-llm_score
    ]
}

resource "aws_api_gateway_resource" "langevals-off_topic" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "off_topic"
}

module "langevals-off_topic-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.langevals-off_topic.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.langevals-off_topic
    ]
}

resource "aws_api_gateway_resource" "langevals-product_sentiment_polarity" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "product_sentiment_polarity"
}

module "langevals-product_sentiment_polarity-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.langevals-product_sentiment_polarity.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.langevals-product_sentiment_polarity
    ]
}

resource "aws_api_gateway_resource" "langevals-similarity" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.langevals.id
    path_part   = "similarity"
}

module "langevals-similarity-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.langevals-similarity.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.langevals-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.langevals-similarity
    ]
}

module "langevals-evaluator" {
    source              = "./lambda"
    evaluator_package   = "langevals"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.langevals.execution_arn
}

resource "aws_api_gateway_resource" "langevals" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_rest_api.langevals.root_resource_id
    path_part   = "langevals"
}

resource "aws_api_gateway_resource" "openai-moderation" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.openai.id
    path_part   = "moderation"
}

module "openai-moderation-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.openai-moderation.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.openai-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.openai-moderation
    ]
}

module "openai-evaluator" {
    source              = "./lambda"
    evaluator_package   = "openai"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.langevals.execution_arn
}

resource "aws_api_gateway_resource" "openai" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_rest_api.langevals.root_resource_id
    path_part   = "openai"
}

resource "aws_api_gateway_resource" "haystack-faithfulness" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.haystack.id
    path_part   = "faithfulness"
}

module "haystack-faithfulness-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.haystack-faithfulness.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.haystack-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.haystack-faithfulness
    ]
}

module "haystack-evaluator" {
    source              = "./lambda"
    evaluator_package   = "haystack"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.langevals.execution_arn
}

resource "aws_api_gateway_resource" "haystack" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_rest_api.langevals.root_resource_id
    path_part   = "haystack"
}

resource "aws_api_gateway_resource" "lingua-language_detection" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.lingua.id
    path_part   = "language_detection"
}

module "lingua-language_detection-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.lingua-language_detection.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.lingua-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.lingua-language_detection
    ]
}

module "lingua-evaluator" {
    source              = "./lambda"
    evaluator_package   = "lingua"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.langevals.execution_arn
}

resource "aws_api_gateway_resource" "lingua" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_rest_api.langevals.root_resource_id
    path_part   = "lingua"
}

resource "aws_api_gateway_resource" "aws-comprehend_pii_detection" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.aws.id
    path_part   = "comprehend_pii_detection"
}

module "aws-comprehend_pii_detection-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.aws-comprehend_pii_detection.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.aws-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.aws-comprehend_pii_detection
    ]
}

module "aws-evaluator" {
    source              = "./lambda"
    evaluator_package   = "aws"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.langevals.execution_arn
}

resource "aws_api_gateway_resource" "aws" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_rest_api.langevals.root_resource_id
    path_part   = "aws"
}

resource "aws_api_gateway_resource" "google_cloud-dlp_pii_detection" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.google_cloud.id
    path_part   = "dlp_pii_detection"
}

module "google_cloud-dlp_pii_detection-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.google_cloud-dlp_pii_detection.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.google_cloud-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.google_cloud-dlp_pii_detection
    ]
}

module "google_cloud-evaluator" {
    source              = "./lambda"
    evaluator_package   = "google_cloud"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.langevals.execution_arn
}

resource "aws_api_gateway_resource" "google_cloud" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_rest_api.langevals.root_resource_id
    path_part   = "google_cloud"
}

resource "aws_api_gateway_resource" "azure-content_safety" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.azure.id
    path_part   = "content_safety"
}

module "azure-content_safety-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.azure-content_safety.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.azure-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.azure-content_safety
    ]
}

resource "aws_api_gateway_resource" "azure-jailbreak" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.azure.id
    path_part   = "jailbreak"
}

module "azure-jailbreak-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.azure-jailbreak.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.azure-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.azure-jailbreak
    ]
}

resource "aws_api_gateway_resource" "azure-prompt_injection" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.azure.id
    path_part   = "prompt_injection"
}

module "azure-prompt_injection-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.azure-prompt_injection.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.azure-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.azure-prompt_injection
    ]
}

module "azure-evaluator" {
    source              = "./lambda"
    evaluator_package   = "azure"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.langevals.execution_arn
}

resource "aws_api_gateway_resource" "azure" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_rest_api.langevals.root_resource_id
    path_part   = "azure"
}

resource "aws_api_gateway_resource" "ragas-answer_correctness" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "answer_correctness"
}

module "ragas-answer_correctness-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.ragas-answer_correctness.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.ragas-answer_correctness
    ]
}

resource "aws_api_gateway_resource" "ragas-answer_relevancy" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "answer_relevancy"
}

module "ragas-answer_relevancy-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.ragas-answer_relevancy.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.ragas-answer_relevancy
    ]
}

resource "aws_api_gateway_resource" "ragas-context_precision" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "context_precision"
}

module "ragas-context_precision-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.ragas-context_precision.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.ragas-context_precision
    ]
}

resource "aws_api_gateway_resource" "ragas-context_recall" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "context_recall"
}

module "ragas-context_recall-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.ragas-context_recall.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.ragas-context_recall
    ]
}

resource "aws_api_gateway_resource" "ragas-context_relevancy" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "context_relevancy"
}

module "ragas-context_relevancy-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.ragas-context_relevancy.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.ragas-context_relevancy
    ]
}

resource "aws_api_gateway_resource" "ragas-context_utilization" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "context_utilization"
}

module "ragas-context_utilization-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.ragas-context_utilization.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.ragas-context_utilization
    ]
}

resource "aws_api_gateway_resource" "ragas-faithfulness" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_resource.ragas.id
    path_part   = "faithfulness"
}

module "ragas-faithfulness-api-gw" {
    source                 = "./api-gw-resource"
    apigw_id               = aws_api_gateway_rest_api.langevals.id
    apigw_root_resource_id = aws_api_gateway_resource.ragas-faithfulness.id
    path                   = "evaluate"
    method                 = "POST"

    lambda_invoke_arn = module.ragas-evaluator.lambda_invoke_arn

    depends_on = [
        aws_api_gateway_resource.ragas-faithfulness
    ]
}

module "ragas-evaluator" {
    source              = "./lambda"
    evaluator_package   = "ragas"
    sns_alarms_topic_arn = aws_sns_topic.alarms.arn
    apigw_execution_arn = aws_api_gateway_rest_api.langevals.execution_arn
}

resource "aws_api_gateway_resource" "ragas" {
    rest_api_id = aws_api_gateway_rest_api.langevals.id
    parent_id   = aws_api_gateway_rest_api.langevals.root_resource_id
    path_part   = "ragas"
}

resource "aws_api_gateway_deployment" "this" {
    count = module.variables.profile == "lw-prod" ? 1 : 0

    triggers = {
        redeployment = sha1(jsonencode([module.huggingface-llama_guard-api-gw, module.langevals-basic-api-gw, module.langevals-competitor_blocklist-api-gw, module.langevals-competitor_llm-api-gw, module.langevals-competitor_llm_function_call-api-gw, module.langevals-llm_boolean-api-gw, module.langevals-llm_score-api-gw, module.langevals-off_topic-api-gw, module.langevals-product_sentiment_polarity-api-gw, module.langevals-similarity-api-gw, module.openai-moderation-api-gw, module.haystack-faithfulness-api-gw, module.lingua-language_detection-api-gw, module.aws-comprehend_pii_detection-api-gw, module.google_cloud-dlp_pii_detection-api-gw, module.azure-content_safety-api-gw, module.azure-jailbreak-api-gw, module.azure-prompt_injection-api-gw, module.ragas-answer_correctness-api-gw, module.ragas-answer_relevancy-api-gw, module.ragas-context_precision-api-gw, module.ragas-context_recall-api-gw, module.ragas-context_relevancy-api-gw, module.ragas-context_utilization-api-gw, module.ragas-faithfulness-api-gw]))
    }

    depends_on = [
        module.huggingface-llama_guard-api-gw, module.langevals-basic-api-gw, module.langevals-competitor_blocklist-api-gw, module.langevals-competitor_llm-api-gw, module.langevals-competitor_llm_function_call-api-gw, module.langevals-llm_boolean-api-gw, module.langevals-llm_score-api-gw, module.langevals-off_topic-api-gw, module.langevals-product_sentiment_polarity-api-gw, module.langevals-similarity-api-gw, module.openai-moderation-api-gw, module.haystack-faithfulness-api-gw, module.lingua-language_detection-api-gw, module.aws-comprehend_pii_detection-api-gw, module.google_cloud-dlp_pii_detection-api-gw, module.azure-content_safety-api-gw, module.azure-jailbreak-api-gw, module.azure-prompt_injection-api-gw, module.ragas-answer_correctness-api-gw, module.ragas-answer_relevancy-api-gw, module.ragas-context_precision-api-gw, module.ragas-context_recall-api-gw, module.ragas-context_relevancy-api-gw, module.ragas-context_utilization-api-gw, module.ragas-faithfulness-api-gw
    ]

    rest_api_id = aws_api_gateway_rest_api.langevals.id
    stage_name  = "v1"
}

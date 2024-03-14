resource "aws_api_gateway_resource" "this" {
  rest_api_id = var.apigw_id
  parent_id   = var.apigw_root_resource_id
  path_part   = var.path
}

resource "aws_api_gateway_method" "this" {
  rest_api_id   = var.apigw_id
  resource_id   = aws_api_gateway_resource.this.id
  http_method   = var.method
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "this" {
  rest_api_id = var.apigw_id
  resource_id = aws_api_gateway_method.this.resource_id
  http_method = aws_api_gateway_method.this.http_method

  integration_http_method = var.method
  type                    = "AWS_PROXY"
  uri                     = var.lambda_invoke_arn
}
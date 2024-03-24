resource "aws_iam_user" "comprehend_user" {
  name = "comprehend-user"
}

resource "aws_iam_policy" "comprehend_policy" {
  name        = "ComprehendDetectPIIEntitiesPolicy"
  description = "Policy for Comprehend detect_pii_entities action"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        "Effect" : "Allow",
        "Action" : [
          "comprehend:ContainsPiiEntities",
          "comprehend:DetectPiiEntities"
        ],
        "Resource" : "*"
      }
    ]
  })
}

resource "aws_iam_user_policy_attachment" "comprehend_user_policy_attachment" {
  user       = aws_iam_user.comprehend_user.name
  policy_arn = aws_iam_policy.comprehend_policy.arn
}

resource "aws_iam_access_key" "comprehend_user_key" {
  user = aws_iam_user.comprehend_user.name
}

output "aws_comprehend_access_key_id" {
  value     = aws_iam_access_key.comprehend_user_key.id
  sensitive = true
}

output "aws_comprehend_secret_access_key" {
  value     = aws_iam_access_key.comprehend_user_key.secret
  sensitive = true
}

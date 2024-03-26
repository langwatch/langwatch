resource "aws_iam_policy" "comprehend" {
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

resource "aws_iam_role" "comprehend" {
  name = "comprehend-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Action = "sts:AssumeRole",
        Principal = {
          Service = "lambda.amazonaws.com"
        },
        Effect = "Allow",
        Sid    = ""
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "comprehend" {
  role       = aws_iam_role.comprehend.name
  policy_arn = aws_iam_policy.comprehend.arn
}

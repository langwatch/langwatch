resource "aws_sns_topic" "alarms" {
  name              = "cw-alarms-topic"
  kms_master_key_id = "alias/aws/sns"

  tags = {
    Name = "cw-alarms-topic"
  }
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_host_count" {
  count               = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name          = "unhealthy-host-count"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = "2"
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = "300"
  statistic           = "Average"
  threshold           = "1"
  alarm_description   = "Triggers when the number of unhealthy hosts exceeds the threshold"
  actions_enabled     = true
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    LoadBalancer = aws_alb.langwatch_alb[0].arn
  }

  treat_missing_data = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "latency" {
  count               = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name          = "high-latency"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "3"
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = "60"
  statistic           = "Average"
  threshold           = "0.5" # Threshold in seconds
  alarm_description   = "Alarm when target response time exceeds 500 ms"
  actions_enabled     = true
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    LoadBalancer = aws_alb.langwatch_alb[0].arn
  }

  treat_missing_data = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "server_errors" {
  count               = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name          = "alb-server-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "1"
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = "300" # 5 minutes
  statistic           = "Sum"
  threshold           = "1" # Trigger the alarm if there is at least one 5XX error
  alarm_description   = "Triggers when the ALB returns 5XX server errors"
  actions_enabled     = true
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    LoadBalancer = aws_alb.langwatch_alb[0].arn
  }

  treat_missing_data = "notBreaching"
}

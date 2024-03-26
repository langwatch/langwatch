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

resource "aws_cloudwatch_event_rule" "guardduty_findings" {
  name        = "guardduty-medium-high-findings"
  description = "Capture medium to high severity GuardDuty findings"

  # severity levels
  #  Low: < 4.0
  #  Medium: >= 4.0 and < 7.0
  #  High: >= 7.0
  event_pattern = jsonencode({
    source      = ["aws.guardduty"],
    detail_type = ["GuardDuty Finding"],
    detail = {
      severity = [
        4, 4.0, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9,
        5, 5.0, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9,
        6, 6.0, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9,
        7, 7.0, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9,
        8, 8.0, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9
      ]
    }
  })
}

resource "aws_cloudwatch_event_target" "guardduty_to_sns" {
  rule      = aws_cloudwatch_event_rule.guardduty_findings.name
  target_id = "SendToSNS"
  arn       = aws_sns_topic.alarms.arn
}

# ALB CloudWatch alarms
resource "aws_cloudwatch_metric_alarm" "unhealthy_host_count" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "unhealthy-host-count"
  comparison_operator       = "GreaterThanOrEqualToThreshold"
  evaluation_periods        = "2"
  metric_name               = "UnHealthyHostCount"
  namespace                 = "AWS/ApplicationELB"
  period                    = "300"
  statistic                 = "Average"
  threshold                 = "1"
  alarm_description         = "Triggers when the number of unhealthy hosts exceeds the threshold"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    LoadBalancer = aws_alb.langwatch_alb[0].arn
  }

  treat_missing_data = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "latency" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "high-latency"
  comparison_operator       = "GreaterThanThreshold"
  evaluation_periods        = "3"
  metric_name               = "TargetResponseTime"
  namespace                 = "AWS/ApplicationELB"
  period                    = "60"
  statistic                 = "Average"
  threshold                 = "0.5" # Threshold in seconds
  alarm_description         = "Alarm when target response time exceeds 500 ms"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    LoadBalancer = aws_alb.langwatch_alb[0].arn
  }

  treat_missing_data = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "server_errors" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "alb-server-errors"
  comparison_operator       = "GreaterThanThreshold"
  evaluation_periods        = "1"
  metric_name               = "HTTPCode_Target_5XX_Count"
  namespace                 = "AWS/ApplicationELB"
  period                    = "300" # 5 minutes
  statistic                 = "Sum"
  threshold                 = "1" # Trigger the alarm if there is at least one 5XX error
  alarm_description         = "Triggers when the ALB returns 5XX server errors"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    LoadBalancer = aws_alb.langwatch_alb[0].arn
  }

  treat_missing_data = "notBreaching"
}

# GuardDuty CloudWatch alarms - Intrusion Detection
resource "aws_cloudwatch_event_rule" "guardduty_findings" {
  count       = module.variables.profile == "lw-prod" ? 1 : 0
  name        = "guardduty-medium-high-findings"
  description = "Capture medium to high severity GuardDuty findings"

  # severity levels
  #  Low: < 4.0
  #  Medium: >= 4.0 and < 7.0
  #  High: >= 7.0
  event_pattern = jsonencode({
    source      = ["aws.guardduty"],
    detail-type = ["GuardDuty Finding"],
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
  count     = module.variables.profile == "lw-prod" ? 1 : 0
  rule      = aws_cloudwatch_event_rule.guardduty_findings[0].name
  target_id = "SendToSNS"
  arn       = aws_sns_topic.alarms.arn
}

# Postgres RDS CloudWatch alarms
resource "aws_cloudwatch_metric_alarm" "rds_cpu_utilization_instance" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "rds-cpu-utilization-instance-${count.index}"
  comparison_operator       = "GreaterThanThreshold"
  evaluation_periods        = "1"
  metric_name               = "CPUUtilization"
  namespace                 = "AWS/RDS"
  period                    = "300" # 5 minutes
  statistic                 = "Average"
  threshold                 = 80.0 # Trigger alarm at 80% CPU utilization
  alarm_description         = "Alarm when RDS instance CPU exceeds 80%"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.langwatch-pg.identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_freeable_memory_instance" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "rds-freeable-memory-instance-${count.index}"
  comparison_operator       = "LessThanThreshold"
  evaluation_periods        = "1"
  metric_name               = "FreeableMemory"
  namespace                 = "AWS/RDS"
  period                    = "300" # 5 minutes
  statistic                 = "Average"
  threshold                 = 50000000 # Trigger alarm if freeable memory is less than 50 MB
  alarm_description         = "Alarm when RDS instance freeable memory is less than 50MB"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.langwatch-pg.identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_disk_queue_depth" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "rds-disk-queue-depth-${count.index}"
  comparison_operator       = "GreaterThanThreshold"
  evaluation_periods        = "1"
  metric_name               = "DiskQueueDepth"
  namespace                 = "AWS/RDS"
  period                    = "300" # 5 minutes
  statistic                 = "Average"
  threshold                 = 5 # TODO: Needs to be adjusted based on the performance of the RDS instance
  alarm_description         = "Alarm when RDS instance DiskQueueDepth exceeds 5"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.langwatch-pg.identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_read_iops" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "rds-read-iops-${count.index}"
  comparison_operator       = "GreaterThanThreshold"
  evaluation_periods        = "1"
  metric_name               = "ReadIOPS"
  namespace                 = "AWS/RDS"
  period                    = "300"
  statistic                 = "Average"
  threshold                 = 100 # TODO: Adjust based on your typical workload and performance needs
  alarm_description         = "Alarm when RDS instance ReadIOPS exceeds 1000"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.langwatch-pg.identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_write_iops" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "rds-write-iops-${count.index}"
  comparison_operator       = "GreaterThanThreshold"
  evaluation_periods        = "1"
  metric_name               = "WriteIOPS"
  namespace                 = "AWS/RDS"
  period                    = "300"
  statistic                 = "Average"
  threshold                 = 100 # #TODO: Adjust based on your typical workload and performance needs
  alarm_description         = "Alarm when RDS instance WriteIOPS exceeds 1000"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.langwatch-pg.identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_free_storage_space" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "rds-free-storage-space-${count.index}"
  comparison_operator       = "LessThanThreshold"
  evaluation_periods        = "1"
  metric_name               = "FreeStorageSpace"
  namespace                 = "AWS/RDS"
  period                    = "300" # 5 minutes
  statistic                 = "Average"
  threshold                 = 1000000000 # 1GB in bytes
  alarm_description         = "Alarm when RDS instance free storage space is less than 1GB"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.langwatch-pg.identifier
  }
}

# EC2 Bastion CloudWatch alarms
resource "aws_cloudwatch_metric_alarm" "ec2_cpu_utilization_alarm" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "ec2-cpu-high"
  comparison_operator       = "GreaterThanThreshold"
  evaluation_periods        = "2"
  metric_name               = "CPUUtilization"
  namespace                 = "AWS/EC2"
  period                    = "300" # 5 minutes
  statistic                 = "Average"
  threshold                 = 80.0 # Trigger at 80% CPU utilization
  alarm_description         = "Alarm when EC2 CPU exceeds 80%"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    InstanceId = aws_instance.bastion[0].id
  }
}

resource "aws_cloudwatch_metric_alarm" "redis_capacity_usage" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "redis-capacity-usage-high"
  comparison_operator       = "GreaterThanThreshold"
  evaluation_periods        = "1"
  metric_name               = "DatabaseCapacityUsagePercentage"
  namespace                 = "AWS/ElastiCache"
  period                    = "300" # 5 minutes
  statistic                 = "Average"
  threshold                 = 50.0 # Trigger alarm at 50% capacity usage
  alarm_description         = "Alarm when Redis capacity usage exceeds 50%"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.redis[0].id
  }
}

resource "aws_cloudwatch_metric_alarm" "redis_cpu_utilization" {
  count                     = module.variables.profile == "lw-prod" ? 1 : 0
  alarm_name                = "redis-cpu-utilization-high"
  comparison_operator       = "GreaterThanThreshold"
  evaluation_periods        = "1"
  metric_name               = "CPUUtilization"
  namespace                 = "AWS/ElastiCache"
  period                    = "300" # 5 minutes
  statistic                 = "Average"
  threshold                 = 50.0 # Trigger alarm at 50% CPU utilization
  alarm_description         = "Alarm when Redis CPU utilization exceeds 50%"
  actions_enabled           = true
  alarm_actions             = [aws_sns_topic.alarms.arn]
  ok_actions                = [aws_sns_topic.alarms.arn]
  insufficient_data_actions = [aws_sns_topic.alarms.arn]

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.redis[0].id
  }
}

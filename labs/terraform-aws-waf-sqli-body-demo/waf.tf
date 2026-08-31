resource "aws_wafv2_web_acl" "main" {
  name        = "${var.project_name}-web-acl"
  description = "Demo Web ACL for SQLi_BODY Count and Label"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # ========================================================
  # Rule 1
  #
  # AWSManagedRulesSQLiRuleSet
  #
  # Only SQLi_BODY:
  # Block -> Count
  #
  # Other rules keep their original actions.
  # ========================================================

  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"

        rule_action_override {
          name = "SQLi_BODY"

          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesSQLiRuleSet"
      sampled_requests_enabled   = true
    }
  }

  # ========================================================
  # Rule 2
  #
  # Block SQLi_BODY except:
  #
  # POST /login
  #
  # Condition:
  #
  # Label Match
  # AND
  # NOT (
  #   URI = /login
  #   AND
  #   Method = POST
  # )
  #
  # If matched -> Block
  #
  # /login POST does not match this rule and continues
  # to Web ACL Default Action = Allow.
  # ========================================================

  rule {
    name     = "Block-SQLi-Body-Except-Login"
    priority = 20

    action {
      block {}
    }

    statement {
      and_statement {

        # SQLi_BODY managed label
        statement {
          label_match_statement {
            scope = "LABEL"
            key   = "awswaf:managed:aws:sql-database:SQLi_Body"
          }
        }

        # Exclude only POST /login
        statement {
          not_statement {
            statement {
              and_statement {

                statement {
                  byte_match_statement {
                    search_string         = "/login"
                    positional_constraint = "EXACTLY"

                    field_to_match {
                      uri_path {}
                    }

                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }

                statement {
                  byte_match_statement {
                    search_string         = "POST"
                    positional_constraint = "EXACTLY"

                    field_to_match {
                      method {}
                    }

                    text_transformation {
                      priority = 0
                      type     = "NONE"
                    }
                  }
                }

              }
            }
          }
        }

      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "BlockSQLiBodyExceptLogin"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-web-acl"
    sampled_requests_enabled   = true
  }

  tags = {
    Name = "${var.project_name}-web-acl"
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}
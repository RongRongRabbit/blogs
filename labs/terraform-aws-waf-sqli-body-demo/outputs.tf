output "alb_dns_name" {
  description = "DNS name of the Application Load Balancer"
  value       = aws_lb.main.dns_name
}

output "base_url" {
  description = "Base URL"
  value       = "http://${aws_lb.main.dns_name}"
}

output "login_url" {
  description = "Login URL used as the exception"
  value       = "http://${aws_lb.main.dns_name}/login"
}

output "normal_url" {
  description = "Normal URL used to verify blocking"
  value       = "http://${aws_lb.main.dns_name}/normal"
}

output "web_acl_name" {
  description = "AWS WAF Web ACL name"
  value       = aws_wafv2_web_acl.main.name
}
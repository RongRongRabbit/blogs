provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "waf-sqli-demo"
      ManagedBy = "Terraform"
      Purpose   = "BlogDemo"
    }
  }
}
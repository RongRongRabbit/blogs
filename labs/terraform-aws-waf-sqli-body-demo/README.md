# AWS WAF SQLi_BODY Count + Label Demo

> A Terraform demo showing how to control **only `SQLi_BODY`** in **AWS Managed Rules** by combining **Count**, **Label**, and **Custom Rules**.

This project demonstrates a practical approach for mitigating false positives while preserving the protection provided by **AWS Managed Rules**.

Instead of disabling the entire SQLi rule group or excluding an endpoint completely, this demo changes only **`SQLi_BODY`** from **Block** to **Count**, attaches an AWS managed label, and performs fine-grained control using a Custom Rule.

---

# Architecture

```text
                 Internet
                     │
                     ▼
        Application Load Balancer (ALB)
                     │
                     ▼
              AWS WAF Web ACL
                     │
                     ▼
      AWSManagedRulesSQLiRuleSet
                     │
         SQLi_BODY Action = Count
                     │
              Managed Label
                     │
         awswaf:managed:aws:sql-database:SQLi_Body
                     │
        ┌────────────┴─────────────┐
        │                          │
        ▼                          ▼
POST /login                Other requests
        │                          │
        ▼                          ▼
Custom Allow Rule          Custom Block Rule
        │                          │
        ▼                          ▼
   ALB Fixed Response          HTTP 403
        │
        ▼
     HTTP 200
```

---

# Why this demo?

A common way to resolve AWS WAF false positives is to exclude an entire managed rule or disable SQL injection inspection for a specific endpoint.

While simple, this approach also removes the protection provided by AWS Managed Rules.

This demo demonstrates a safer alternative.

Instead of excluding the rule, it:

- Keeps AWS Managed Rules enabled
- Changes only `SQLi_BODY` to **Count**
- Uses the AWS managed label
- Applies exceptions only to specific requests

This minimizes the security impact while resolving false positives.

---

# Features

- AWS WAF v2
- AWS Managed Rules
- SQLi_BODY Rule Action Override
- Count
- Label Match Statement
- Custom Rules
- Application Load Balancer
- Terraform
- No EC2 required

---

# Resources

Terraform creates the following resources.

| Resource | Description |
|----------|-------------|
| VPC | Demo VPC |
| Internet Gateway | Internet access |
| Public Subnets | Two public subnets |
| Route Table | Public routing |
| Security Group | ALB Security Group |
| ALB | Application Load Balancer |
| HTTP Listener | Fixed Response |
| AWS WAF Web ACL | Regional Web ACL |
| AWS Managed Rules | SQLi Rule Group |
| Custom Rules | Label Match Rules |

No EC2 instance is required.

---

# Directory Structure

```text
terraform-aws-waf-sqli-body-demo
│
├── versions.tf
├── provider.tf
├── variables.tf
├── networking.tf
├── alb.tf
├── waf.tf
├── outputs.tf
├── test.sh
├── docs
│   └── architecture.png
└── README.md
```

---

# Prerequisites

- Terraform >= 1.5
- AWS CLI
- AWS Account
- Appropriate IAM permissions

---

# Deploy

Initialize Terraform.

```bash
terraform init
```

Validate the configuration.

```bash
terraform validate
```

Review the execution plan.

```bash
terraform plan
```

Deploy the infrastructure.

```bash
terraform apply
```

Terraform will output something similar to:

```text
Outputs:

base_url
login_url
normal_url
alb_dns_name
```

---

# Test

Make the script executable.

```bash
chmod +x test.sh
```

Run the demo.

```bash
./test.sh
```

---

# Expected Behavior

## Test 1

Normal login request

```
POST /login
```

Expected result

```
HTTP 200
```

---

## Test 2

SQLi-like request

```
POST /login
```

Expected flow

```text
SQLi_BODY

↓

Count

↓

AWS Managed Label

↓

Custom Allow Rule

↓

HTTP 200
```

---

## Test 3

Same SQLi-like request

```
POST /normal
```

Expected flow

```text
SQLi_BODY

↓

Count

↓

AWS Managed Label

↓

Custom Block Rule

↓

HTTP 403
```

---

# Rule Flow

```text
AWSManagedRulesSQLiRuleSet
            │
            ▼
SQLi_BODY
(Block → Count)
            │
            ▼
Managed Label
            │
            ▼
Label Match Rule
            │
      ┌─────┴─────┐
      │           │
      ▼           ▼
POST /login   Other URI
      │           │
      ▼           ▼
Allow        Block
```

---

# Screenshots

After deployment you can capture the following screenshots for documentation or blog posts.

- Web ACL Overview
- Rule Priority
- SQLi_BODY Rule Override
- AWS Managed Label
- Custom Rule
- Sampled Requests
- CloudShell Test Result

---

# Cleanup

Destroy all resources.

```bash
terraform destroy
```

---

# Estimated Cost

This demo is designed for temporary testing.

Estimated cost for approximately **2–3 hours**.

| Resource | Estimated Cost |
|----------|----------------|
| AWS WAF Web ACL | Low |
| AWS Managed Rule | Low |
| ALB | Low |

Delete all resources after testing to avoid unnecessary charges.

---

# References

- AWS WAF Developer Guide
- AWS Managed Rules for AWS WAF
- Terraform AWS Provider

---

# Blog

This project accompanies the following Zenn article.

> **AWS WAF の SQLi_BODYだけを制御する｜Managed Rule の Count + Label を使った誤検知対策**

The article explains:

- Why SQLi_BODY false positives occur
- Why Count + Label is preferable to excluding the rule
- How AWS Managed Labels work
- How to build safer exception handling with Custom Rules

---

# License

MIT
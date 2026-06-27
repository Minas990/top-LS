terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "eu-central-1"
}

variable "project_name" {
  type    = string
  default = "github-stats"
}

variable "instance_type" {
  type    = string
  default = "t3.micro" # free-tier eligible
}

variable "github_token" {
  type        = string
  description = "GitHub PAT for raising the API rate limit to 5000/hr. Leave empty to run unauthenticated (60/hr)."
  default     = ""
  sensitive   = true
}

# Toggle this to true only while you're actively testing the
# private-subnet + NAT path. Costs ~$0.045/hr the moment it's true.
# Set back to false and re-apply to tear it down.
variable "enable_nat_gateway" {
  type    = bool
  default = false
}

data "aws_availability_zones" "available" {
  state = "available"
}

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  backend "s3" {
    bucket         = "vgdp-terraform-state"
    key            = "aws/vgdp.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "vgdp-terraform-locks"
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "vgdp"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
